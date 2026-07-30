import {and, asc, desc, eq} from 'drizzle-orm'
import {BaseAgent} from '../agent/base-agent.js'
import type {AgentConfig, AgentEvent} from '../agent/types/agent.js'
import {createApiError} from '../api/errors/api-error.js'
import {env} from '../config/env.js'
import {db} from '../db/index.js'
import {agents, conversations, messages} from '../db/schema.js'
import type {LLMMessage, LLMUsage} from '../llm/domain/llm-provider.js'
import {AISDKProviderAdapter} from '../llm/providers/ai-sdk-provider.js'
import {FallbackLLMProvider} from '../llm/providers/fallback-provider.js'
import {resolveModel} from '../llm/registry/model-registry.js'
import {providerRegistry} from '../llm/registry/provider-registry.js'
import {resolveBuiltinTools} from '../tools/builtin/index.js'
import {ToolRegistry} from '../tools/registry/tool-registry.js'
import {
    createAiTrace,
    type DatabaseAgentTrace,
    finishAiTrace,
} from './ai-trace-service.js'
import {findUserAgent} from './agent-service.js'
import {acquireChatExecutionLease, type ConcurrencyLease} from './chat-concurrency-service.js'

const HISTORY_MESSAGE_LIMIT = 50

export interface ChatInput {
    userId: string
    agentId: string
    message: string
    sessionId?: string
    requestId?: string
    abortSignal?: AbortSignal
}

export interface ToolCallRecord {
    id: string
    name: string
    args: unknown
    result: unknown
}

export interface ChatResult {
    reply: string
    sessionId: string
    traceId?: string
    toolCalls: Array<Omit<ToolCallRecord, 'id'>>
}

export type ChatStreamEvent =
    | {type: 'text-delta'; content: string}
    | {type: 'tool-call'; id: string; name: string; args: unknown}
    | {type: 'tool-result'; id: string; name: string; result: unknown}
    | {type: 'finish'; usage?: LLMUsage}
    | {type: 'done'; sessionId: string; traceId?: string}

interface PreparedExecution {
    agent: BaseAgent
    conversation: typeof conversations.$inferSelect
    history: LLMMessage[]
    lease: ConcurrencyLease
    trace?: DatabaseAgentTrace
}

interface ExecutionState {
    reply: string
    toolCalls: ToolCallRecord[]
    stepCount: number
    usage?: LLMUsage
}

function publicExecutionError(error?: Error): string {
    return env.isProduction
        ? 'Agent execution failed'
        : error?.message ?? 'Agent execution failed'
}

function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
}

function createAgentFromConfig(agentRow: typeof agents.$inferSelect): BaseAgent {
    const selectedTools = resolveBuiltinTools(agentRow.tools)
    const modelId = resolveModel(agentRow.modelProfile)
    const fallbackModelId = resolveModel('fallback')
    const config: AgentConfig = {
        name: agentRow.name,
        description: agentRow.description ?? '',
        systemPrompt: agentRow.systemPrompt ?? 'You are a helpful assistant.',
        modelProfile: agentRow.modelProfile,
        modelId,
        maxSteps: agentRow.maxSteps,
    }
    const primary = new AISDKProviderAdapter(providerRegistry.languageModel(modelId as any))
    const fallback = fallbackModelId !== modelId
        ? new AISDKProviderAdapter(providerRegistry.languageModel(fallbackModelId as any))
        : undefined
    const provider = new FallbackLLMProvider(primary, fallback)

    return new (class extends BaseAgent {
        getTools() {
            return selectedTools
        }
    })(config, provider, new ToolRegistry())
}

async function findConversationBySession(userId: string, sessionId: string) {
    const [conversation] = await db.select().from(conversations).where(and(
        eq(conversations.userId, userId),
        eq(conversations.sessionId, sessionId),
    )).limit(1)

    return conversation
}

function ensureConversationAgent(
    conversation: typeof conversations.$inferSelect,
    agentId: string,
) {
    if (conversation.agentId !== agentId) {
        throw createApiError(
            409,
            'SESSION_AGENT_MISMATCH',
            'The session is already associated with another agent',
        )
    }

    return conversation
}

async function getOrCreateConversation(userId: string, agentId: string, sessionId?: string) {
    const resolvedSessionId = sessionId?.trim() || crypto.randomUUID()
    const existing = await findConversationBySession(userId, resolvedSessionId)
    if (existing) return ensureConversationAgent(existing, agentId)

    const [created] = await db.insert(conversations)
        .values({userId, agentId, sessionId: resolvedSessionId})
        .onConflictDoNothing({
            target: [conversations.userId, conversations.sessionId],
        })
        .returning()

    if (created) return created

    const concurrent = await findConversationBySession(userId, resolvedSessionId)
    if (!concurrent) {
        throw createApiError(500, 'CONVERSATION_CREATE_FAILED', 'Failed to create conversation')
    }

    return ensureConversationAgent(concurrent, agentId)
}

function historyContent(message: {
    content: string | null
    toolCalls: unknown
}): string | null {
    const parts: string[] = []
    if (message.content?.trim()) parts.push(message.content)
    if (message.toolCalls) parts.push(`Tool activity: ${JSON.stringify(message.toolCalls)}`)
    return parts.length > 0 ? parts.join('\n') : null
}

async function loadConversationHistory(conversationId: string): Promise<LLMMessage[]> {
    const recentMessages = await db.select({
        role: messages.role,
        content: messages.content,
        toolCalls: messages.toolCalls,
    })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.createdAt), desc(messages.role))
        .limit(HISTORY_MESSAGE_LIMIT)

    return recentMessages
        .reverse()
        .map((message) => ({...message, normalizedContent: historyContent(message)}))
        .filter((message) => message.normalizedContent !== null)
        .map((message) => ({
            role: message.role,
            content: message.normalizedContent!,
        }))
}

function applyAgentEvent(event: AgentEvent, state: ExecutionState): void {
    state.stepCount = Math.max(state.stepCount, event.stepNumber ?? 0)

    if (event.type === 'text-delta') {
        state.reply += event.text ?? ''
        return
    }

    if (event.type === 'tool-call' && event.toolCall) {
        state.toolCalls.push({
            id: event.toolCall.id,
            name: event.toolCall.name,
            args: event.toolCall.input,
            result: null,
        })
        return
    }

    if (event.type === 'tool-result' && event.toolResult) {
        const call = state.toolCalls.find((item) => item.id === event.toolResult?.toolCallId)
        if (call) call.result = event.toolResult.result
        return
    }

    if (event.type === 'finish') state.usage = event.usage
}

function ensureCompleteResponse(state: ExecutionState): void {
    if (state.reply.trim() || state.toolCalls.length > 0) return
    throw createApiError(502, 'EMPTY_AGENT_RESPONSE', 'Agent completed without producing a response')
}

async function persistSuccessfulExchange(
    conversationId: string,
    inputMessage: string,
    state: Pick<ExecutionState, 'reply' | 'toolCalls'>,
): Promise<void> {
    const userCreatedAt = new Date()
    const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1)

    await db.transaction(async (tx) => {
        await tx.insert(messages).values({
            conversationId,
            role: 'user',
            content: inputMessage,
            createdAt: userCreatedAt,
        })
        await tx.insert(messages).values({
            conversationId,
            role: 'assistant',
            content: state.reply || null,
            toolCalls: state.toolCalls.length > 0 ? state.toolCalls : null,
            createdAt: assistantCreatedAt,
        })
    })
}

async function createTraceSafely(input: ChatInput, conversation: typeof conversations.$inferSelect) {
    if (!env.tracing.enabled) return undefined

    try {
        return await createAiTrace({
            requestId: input.requestId,
            userId: input.userId,
            agentId: input.agentId,
            conversationId: conversation.id,
            sessionId: conversation.sessionId,
            functionId: 'study-agent.chat',
            input: {
                message: input.message,
                historyLimit: HISTORY_MESSAGE_LIMIT,
            },
            metadata: {
                transport: input.requestId ? 'http' : 'internal',
            },
        })
    } catch (error) {
        console.error('[chat] Failed to initialize AI trace; continuing without tracing', error)
        return undefined
    }
}

async function finishTraceSafely(
    trace: DatabaseAgentTrace | undefined,
    state: ExecutionState,
    status: 'success' | 'error' | 'aborted',
    error?: Error,
): Promise<void> {
    if (!trace) return

    try {
        await finishAiTrace(trace, {
            status,
            output: {
                reply: state.reply,
                toolCalls: state.toolCalls,
            },
            usage: state.usage,
            stepCount: state.stepCount,
            toolCallCount: state.toolCalls.length,
            error,
        })
    } catch (traceError) {
        console.error('[chat] Failed to finalize AI trace', {
            traceId: trace.traceId,
            error: traceError,
        })
    }
}

async function prepareExecution(input: ChatInput): Promise<PreparedExecution> {
    const agentRow = await findUserAgent(input.userId, input.agentId)
    const conversation = await getOrCreateConversation(
        input.userId,
        input.agentId,
        input.sessionId,
    )
    const lease = acquireChatExecutionLease(input.userId, conversation.sessionId)
    let trace: DatabaseAgentTrace | undefined

    try {
        const history = await loadConversationHistory(conversation.id)
        trace = await createTraceSafely(input, conversation)
        return {
            agent: createAgentFromConfig(agentRow),
            conversation,
            history,
            lease,
            trace,
        }
    } catch (error) {
        if (trace) {
            await finishTraceSafely(
                trace,
                {reply: '', toolCalls: [], stepCount: 0},
                'error',
                normalizeError(error),
            )
        }
        lease.release()
        throw error
    }
}

function createExecutionState(): ExecutionState {
    return {reply: '', toolCalls: [], stepCount: 0}
}

export async function executeChat(input: ChatInput): Promise<ChatResult> {
    const execution = await prepareExecution(input)
    const state = createExecutionState()

    try {
        for await (const event of execution.agent.run(input.message, {
            history: execution.history,
            abortSignal: input.abortSignal,
            trace: execution.trace,
            toolContext: {
                userId: input.userId,
                sessionId: execution.conversation.sessionId,
            },
        })) {
            applyAgentEvent(event, state)
            if (event.type === 'error') {
                throw createApiError(
                    502,
                    'AGENT_EXECUTION_FAILED',
                    publicExecutionError(event.error),
                )
            }
        }

        ensureCompleteResponse(state)
        await persistSuccessfulExchange(execution.conversation.id, input.message, state)
        await finishTraceSafely(execution.trace, state, 'success')
        return {
            reply: state.reply,
            sessionId: execution.conversation.sessionId,
            traceId: execution.trace?.traceId,
            toolCalls: state.toolCalls.map(({id: _id, ...call}) => call),
        }
    } catch (error) {
        const normalizedError = normalizeError(error)
        await finishTraceSafely(
            execution.trace,
            state,
            input.abortSignal?.aborted ? 'aborted' : 'error',
            normalizedError,
        )
        throw error
    } finally {
        execution.lease.release()
    }
}

export async function *streamChat(input: ChatInput): AsyncGenerator<ChatStreamEvent> {
    const execution = await prepareExecution(input)
    const state = createExecutionState()

    try {
        for await (const event of execution.agent.run(input.message, {
            history: execution.history,
            abortSignal: input.abortSignal,
            trace: execution.trace,
            toolContext: {
                userId: input.userId,
                sessionId: execution.conversation.sessionId,
            },
        })) {
            applyAgentEvent(event, state)

            if (event.type === 'text-delta') {
                yield {type: 'text-delta', content: event.text ?? ''}
            } else if (event.type === 'tool-call' && event.toolCall) {
                yield {
                    type: 'tool-call',
                    id: event.toolCall.id,
                    name: event.toolCall.name,
                    args: event.toolCall.input,
                }
            } else if (event.type === 'tool-result' && event.toolResult) {
                yield {
                    type: 'tool-result',
                    id: event.toolResult.toolCallId,
                    name: event.toolResult.name,
                    result: event.toolResult.result,
                }
            } else if (event.type === 'finish') {
                yield {type: 'finish', usage: event.usage}
            } else if (event.type === 'error') {
                throw createApiError(
                    502,
                    'AGENT_EXECUTION_FAILED',
                    publicExecutionError(event.error),
                )
            }
        }

        ensureCompleteResponse(state)
        await persistSuccessfulExchange(execution.conversation.id, input.message, state)
        await finishTraceSafely(execution.trace, state, 'success')
        if (!input.abortSignal?.aborted) {
            yield {
                type: 'done',
                sessionId: execution.conversation.sessionId,
                traceId: execution.trace?.traceId,
            }
        }
    } catch (error) {
        const normalizedError = normalizeError(error)
        await finishTraceSafely(
            execution.trace,
            state,
            input.abortSignal?.aborted ? 'aborted' : 'error',
            normalizedError,
        )
        throw error
    } finally {
        execution.lease.release()
    }
}

export async function getChatHistory(userId: string, sessionId: string) {
    const conversation = await findConversationBySession(userId, sessionId)
    if (!conversation) {
        throw createApiError(404, 'SESSION_NOT_FOUND', 'Session not found')
    }

    const items = await db.select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(asc(messages.createdAt), asc(messages.role))

    return items.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content ?? undefined,
        toolCalls: message.toolCalls ?? undefined,
        createdAt: message.createdAt.toISOString(),
    }))
}
