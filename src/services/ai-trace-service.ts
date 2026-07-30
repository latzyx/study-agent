import {and, asc, desc, eq, lt, sql} from 'drizzle-orm'
import type {AgentTraceRecorder} from '../agent/types/agent.js'
import {createApiError} from '../api/errors/api-error.js'
import {env} from '../config/env.js'
import {db} from '../db/index.js'
import {aiRuns, aiSpans} from '../db/schema.js'
import type {
    LLMTelemetrySettings,
    LLMToolCall,
    LLMUsage,
} from '../llm/domain/llm-provider.js'

const SECRET_KEY_PATTERN = /authorization|cookie|password|passwd|secret|token|api[-_]?key/i
const MAX_ARRAY_ITEMS = 100
const MAX_OBJECT_KEYS = 100

export type AiRunStatus = 'running' | 'success' | 'error' | 'aborted'
export type AiSpanStatus = AiRunStatus

export interface CreateAiTraceInput {
    requestId?: string
    userId: string
    agentId: string
    conversationId: string
    sessionId: string
    functionId: string
    input: unknown
    metadata?: Record<string, unknown>
}

export interface FinishAiTraceInput {
    status: Exclude<AiRunStatus, 'running'>
    output?: unknown
    usage?: LLMUsage
    stepCount: number
    toolCallCount: number
    error?: Error
}

interface ModelIdentity {
    provider?: string
    modelId?: string
}

class TraceWriteQueue {
    private tail: Promise<void> = Promise.resolve()
    private failedWrites = 0

    enqueue(operation: () => Promise<void>): void {
        this.tail = this.tail
            .then(operation)
            .catch((error) => {
                this.failedWrites += 1
                console.error('[ai-trace] Failed to persist telemetry event', error)
            })
    }

    async flush(): Promise<void> {
        await this.tail
        if (this.failedWrites > 0) {
            console.warn('[ai-trace] Trace completed with failed writes', {
                failedWrites: this.failedWrites,
            })
        }
    }
}

function truncateString(value: string): string {
    const limit = env.tracing.maxSnapshotChars
    if (value.length <= limit) return value
    return `${value.slice(0, limit)}…[truncated ${value.length - limit} chars]`
}

export function sanitizeTraceSnapshot(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value ?? null
    if (typeof value === 'string') return truncateString(value)
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Date) return value.toISOString()
    if (value instanceof Error) {
        return {
            name: value.name,
            message: truncateString(value.message),
        }
    }
    if (depth >= 8) return '[max-depth]'

    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => sanitizeTraceSnapshot(item, depth + 1))
    }

    if (typeof value === 'object') {
        const output: Record<string, unknown> = {}
        const entries = Object.entries(value as Record<string, unknown>)
            .slice(0, MAX_OBJECT_KEYS)
        for (const [key, item] of entries) {
            output[key] = SECRET_KEY_PATTERN.test(key)
                ? '[redacted]'
                : sanitizeTraceSnapshot(item, depth + 1)
        }
        return output
    }

    return truncateString(String(value))
}

function modelIdentity(event: any): ModelIdentity {
    const model = event?.model
    if (!model || typeof model !== 'object') return {}
    return {
        provider: typeof model.provider === 'string' ? model.provider : undefined,
        modelId: typeof model.modelId === 'string' ? model.modelId : undefined,
    }
}

function usageFrom(event: any): LLMUsage | undefined {
    const usage = event?.totalUsage ?? event?.usage
    if (!usage || typeof usage !== 'object') return undefined
    return {
        inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined,
        outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined,
        totalTokens: typeof usage.totalTokens === 'number' ? usage.totalTokens : undefined,
    }
}

function errorFrom(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value))
}

export class DatabaseAgentTrace implements AgentTraceRecorder {
    private readonly queue = new TraceWriteQueue()
    private readonly spanStartedAt = new Map<string, number>()

    constructor(
        readonly runId: string,
        readonly traceId: string,
        private readonly functionId: string,
    ) {}

    private elapsed(spanKey: string, fallback?: number): number {
        if (typeof fallback === 'number' && Number.isFinite(fallback)) {
            return Math.max(0, Math.round(fallback))
        }
        const started = this.spanStartedAt.get(spanKey)
        return started === undefined ? 0 : Math.max(0, Math.round(performance.now() - started))
    }

    private startSpan(input: {
        spanKey: string
        parentSpanKey?: string
        kind: 'generation' | 'step' | 'tool'
        name: string
        stepNumber?: number
        toolCallId?: string
        model?: ModelIdentity
        input?: unknown
        metadata?: unknown
    }): void {
        this.spanStartedAt.set(input.spanKey, performance.now())
        this.queue.enqueue(async () => {
            await db.insert(aiSpans).values({
                runId: this.runId,
                spanKey: input.spanKey,
                parentSpanKey: input.parentSpanKey,
                kind: input.kind,
                name: input.name,
                status: 'running',
                stepNumber: input.stepNumber,
                toolCallId: input.toolCallId,
                modelProvider: input.model?.provider,
                modelId: input.model?.modelId,
                inputSnapshot: env.tracing.recordInputs
                    ? sanitizeTraceSnapshot(input.input)
                    : undefined,
                metadata: sanitizeTraceSnapshot(input.metadata),
            }).onConflictDoUpdate({
                target: [aiSpans.runId, aiSpans.spanKey],
                set: {
                    status: 'running',
                    parentSpanKey: input.parentSpanKey,
                    name: input.name,
                    stepNumber: input.stepNumber,
                    toolCallId: input.toolCallId,
                    modelProvider: input.model?.provider,
                    modelId: input.model?.modelId,
                    inputSnapshot: env.tracing.recordInputs
                        ? sanitizeTraceSnapshot(input.input)
                        : undefined,
                    metadata: sanitizeTraceSnapshot(input.metadata),
                    startedAt: new Date(),
                    finishedAt: null,
                    durationMs: null,
                    errorName: null,
                    errorMessage: null,
                },
            })
        })
    }

    private finishSpan(input: {
        spanKey: string
        status: Exclude<AiSpanStatus, 'running'>
        output?: unknown
        usage?: LLMUsage
        finishReason?: string
        error?: Error
        durationMs?: number
    }): void {
        const durationMs = this.elapsed(input.spanKey, input.durationMs)
        this.spanStartedAt.delete(input.spanKey)
        this.queue.enqueue(async () => {
            await db.update(aiSpans).set({
                status: input.status,
                outputSnapshot: env.tracing.recordOutputs
                    ? sanitizeTraceSnapshot(input.output)
                    : undefined,
                inputTokens: input.usage?.inputTokens,
                outputTokens: input.usage?.outputTokens,
                totalTokens: input.usage?.totalTokens,
                finishReason: input.finishReason,
                errorName: input.error?.name,
                errorMessage: input.error ? truncateString(input.error.message) : undefined,
                finishedAt: new Date(),
                durationMs,
            }).where(and(
                eq(aiSpans.runId, this.runId),
                eq(aiSpans.spanKey, input.spanKey),
            ))
        })
    }

    telemetryForStep(stepNumber: number, model: string): LLMTelemetrySettings | undefined {
        if (!env.tracing.enabled) return undefined

        return {
            isEnabled: true,
            recordInputs: env.tracing.recordInputs,
            recordOutputs: env.tracing.recordOutputs,
            functionId: this.functionId,
            metadata: {
                traceId: this.traceId,
                runId: this.runId,
                agentStep: stepNumber,
                requestedModel: model,
            },
            onStart: (event) => this.generationStarted(stepNumber, event),
            onStepStart: (event) => this.providerStepStarted(stepNumber, event),
            onToolCallStart: (event) => this.aiSdkToolStarted(stepNumber, event),
            onToolCallFinish: (event) => this.aiSdkToolFinished(stepNumber, event),
            onStepFinish: (event) => this.providerStepFinished(stepNumber, event),
            onFinish: (event) => this.generationFinished(stepNumber, event),
        }
    }

    generationStarted(agentStep: number, event: any): void {
        const spanKey = `generation:${agentStep}`
        const model = modelIdentity(event)
        this.startSpan({
            spanKey,
            kind: 'generation',
            name: 'ai.streamText',
            stepNumber: agentStep,
            model,
            input: {
                system: event?.system,
                prompt: event?.prompt,
                messages: event?.messages,
                toolNames: event?.tools ? Object.keys(event.tools) : [],
                temperature: event?.temperature,
                maxOutputTokens: event?.maxOutputTokens,
            },
            metadata: event?.metadata,
        })
        this.queue.enqueue(async () => {
            await db.update(aiRuns).set({
                modelProvider: model.provider,
                modelId: model.modelId,
            }).where(eq(aiRuns.id, this.runId))
        })
    }

    providerStepStarted(agentStep: number, event: any): void {
        const providerStep = typeof event?.stepNumber === 'number' ? event.stepNumber : 0
        this.startSpan({
            spanKey: `step:${agentStep}:${providerStep}`,
            parentSpanKey: `generation:${agentStep}`,
            kind: 'step',
            name: 'ai.streamText.doStream',
            stepNumber: agentStep,
            model: modelIdentity(event),
            input: {
                messages: event?.messages,
                toolNames: event?.tools ? Object.keys(event.tools) : [],
                activeTools: event?.activeTools,
                providerOptions: event?.providerOptions,
            },
            metadata: {
                aiSdkStepNumber: providerStep,
                functionId: event?.functionId,
                telemetryMetadata: event?.metadata,
            },
        })
    }

    providerStepFinished(agentStep: number, event: any): void {
        const providerStep = typeof event?.stepNumber === 'number' ? event.stepNumber : 0
        this.finishSpan({
            spanKey: `step:${agentStep}:${providerStep}`,
            status: event?.finishReason === 'error' ? 'error' : 'success',
            output: {
                text: event?.text,
                reasoning: event?.reasoning,
                toolCalls: event?.toolCalls,
                toolResults: event?.toolResults,
                warnings: event?.warnings,
                response: event?.response,
                providerMetadata: event?.providerMetadata,
            },
            usage: usageFrom(event),
            finishReason: typeof event?.finishReason === 'string' ? event.finishReason : undefined,
        })
    }

    generationFinished(agentStep: number, event: any): void {
        this.finishSpan({
            spanKey: `generation:${agentStep}`,
            status: event?.finishReason === 'error' ? 'error' : 'success',
            output: {
                text: event?.text,
                toolCalls: event?.toolCalls,
                toolResults: event?.toolResults,
                steps: event?.steps,
                response: event?.response,
            },
            usage: usageFrom(event),
            finishReason: typeof event?.finishReason === 'string' ? event.finishReason : undefined,
        })
    }

    aiSdkToolStarted(agentStep: number, event: any): void {
        const toolCall = event?.toolCall
        if (!toolCall) return
        const toolCallId = String(toolCall.toolCallId ?? toolCall.id ?? crypto.randomUUID())
        this.startSpan({
            spanKey: `sdk-tool:${agentStep}:${toolCallId}`,
            parentSpanKey: `generation:${agentStep}`,
            kind: 'tool',
            name: String(toolCall.toolName ?? toolCall.name ?? 'unknown-tool'),
            stepNumber: agentStep,
            toolCallId,
            model: modelIdentity(event),
            input: toolCall.input,
            metadata: {source: 'ai-sdk'},
        })
    }

    aiSdkToolFinished(agentStep: number, event: any): void {
        const toolCall = event?.toolCall
        if (!toolCall) return
        const toolCallId = String(toolCall.toolCallId ?? toolCall.id ?? '')
        if (!toolCallId) return
        const success = event?.success !== false
        this.finishSpan({
            spanKey: `sdk-tool:${agentStep}:${toolCallId}`,
            status: success ? 'success' : 'error',
            output: success ? event?.output : undefined,
            error: success ? undefined : errorFrom(event?.error),
            durationMs: event?.durationMs,
        })
    }

    toolStarted(stepNumber: number, toolCall: LLMToolCall): void {
        this.startSpan({
            spanKey: `tool:${stepNumber}:${toolCall.id}`,
            parentSpanKey: `generation:${stepNumber}`,
            kind: 'tool',
            name: toolCall.name,
            stepNumber,
            toolCallId: toolCall.id,
            input: toolCall.input,
            metadata: {source: 'study-agent-tool-registry'},
        })
    }

    toolFinished(
        stepNumber: number,
        toolCall: LLMToolCall,
        outcome: {success: true; result: unknown} | {success: false; error: Error},
        durationMs: number,
    ): void {
        this.finishSpan({
            spanKey: `tool:${stepNumber}:${toolCall.id}`,
            status: outcome.success ? 'success' : 'error',
            output: outcome.success ? outcome.result : undefined,
            error: outcome.success ? undefined : outcome.error,
            durationMs,
        })
    }

    async flush(): Promise<void> {
        await this.queue.flush()
    }
}

export async function createAiTrace(input: CreateAiTraceInput): Promise<DatabaseAgentTrace> {
    const traceId = crypto.randomUUID()
    const [run] = await db.insert(aiRuns).values({
        traceId,
        requestId: input.requestId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        functionId: input.functionId,
        status: 'running',
        inputSnapshot: env.tracing.recordInputs ? sanitizeTraceSnapshot(input.input) : undefined,
        metadata: sanitizeTraceSnapshot(input.metadata),
    }).returning({id: aiRuns.id})

    if (!run) throw createApiError(500, 'TRACE_CREATE_FAILED', 'Failed to create AI trace')

    return new DatabaseAgentTrace(run.id, traceId, input.functionId)
}

export async function finishAiTrace(
    trace: DatabaseAgentTrace,
    input: FinishAiTraceInput,
): Promise<void> {
    await trace.flush()
    const [run] = await db.select({startedAt: aiRuns.startedAt})
        .from(aiRuns)
        .where(eq(aiRuns.id, trace.runId))
        .limit(1)
    const durationMs = run
        ? Math.max(0, Date.now() - run.startedAt.getTime())
        : 0

    await db.update(aiRuns).set({
        status: input.status,
        outputSnapshot: env.tracing.recordOutputs
            ? sanitizeTraceSnapshot(input.output)
            : undefined,
        inputTokens: input.usage?.inputTokens,
        outputTokens: input.usage?.outputTokens,
        totalTokens: input.usage?.totalTokens,
        stepCount: input.stepCount,
        toolCallCount: input.toolCallCount,
        errorName: input.error?.name,
        errorMessage: input.error ? truncateString(input.error.message) : undefined,
        finishedAt: new Date(),
        durationMs,
    }).where(eq(aiRuns.id, trace.runId))
}

function serializeRun(run: typeof aiRuns.$inferSelect) {
    return {
        ...run,
        inputSnapshot: run.inputSnapshot ?? undefined,
        outputSnapshot: run.outputSnapshot ?? undefined,
        metadata: run.metadata ?? undefined,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString(),
        createdAt: run.createdAt.toISOString(),
    }
}

function serializeSpan(span: typeof aiSpans.$inferSelect) {
    return {
        ...span,
        inputSnapshot: span.inputSnapshot ?? undefined,
        outputSnapshot: span.outputSnapshot ?? undefined,
        metadata: span.metadata ?? undefined,
        startedAt: span.startedAt.toISOString(),
        finishedAt: span.finishedAt?.toISOString(),
        createdAt: span.createdAt.toISOString(),
    }
}

export async function listAiTraces(input: {
    userId: string
    page: number
    pageSize: number
    sessionId?: string
    agentId?: string
    status?: AiRunStatus
}) {
    const conditions = [eq(aiRuns.userId, input.userId)]
    if (input.sessionId) conditions.push(eq(aiRuns.sessionId, input.sessionId))
    if (input.agentId) conditions.push(eq(aiRuns.agentId, input.agentId))
    if (input.status) conditions.push(eq(aiRuns.status, input.status))
    const where = and(...conditions)
    const offset = (input.page - 1) * input.pageSize

    const [countResult, runs] = await Promise.all([
        db.select({count: sql<number>`count(*)::int`})
            .from(aiRuns)
            .where(where)
            .then((rows) => rows[0]),
        db.select()
            .from(aiRuns)
            .where(where)
            .orderBy(desc(aiRuns.createdAt))
            .limit(input.pageSize)
            .offset(offset),
    ])

    return {
        items: runs.map(serializeRun),
        total: countResult?.count ?? 0,
    }
}

export async function getAiTrace(userId: string, traceId: string) {
    const [run] = await db.select().from(aiRuns).where(and(
        eq(aiRuns.traceId, traceId),
        eq(aiRuns.userId, userId),
    )).limit(1)
    if (!run) throw createApiError(404, 'TRACE_NOT_FOUND', 'AI trace not found')

    const spans = await db.select()
        .from(aiSpans)
        .where(eq(aiSpans.runId, run.id))
        .orderBy(asc(aiSpans.startedAt))

    return {
        run: serializeRun(run),
        spans: spans.map(serializeSpan),
    }
}

export async function recoverStaleAiRuns(staleAfterMinutes = 60): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000)
    const recovered = await db.update(aiRuns).set({
        status: 'aborted',
        errorName: 'StaleRunRecovered',
        errorMessage: 'Run was still marked as running after process interruption',
        finishedAt: new Date(),
        durationMs: sql<number>`greatest(0, extract(epoch from (now() - ${aiRuns.startedAt})) * 1000)::int`,
    }).where(and(
        eq(aiRuns.status, 'running'),
        lt(aiRuns.startedAt, cutoff),
    )).returning({id: aiRuns.id})

    return recovered.length
}

export async function purgeExpiredAiTraces(): Promise<number> {
    const cutoff = new Date(Date.now() - env.tracing.retentionDays * 86_400_000)
    const deleted = await db.delete(aiRuns)
        .where(lt(aiRuns.createdAt, cutoff))
        .returning({id: aiRuns.id})
    return deleted.length
}
