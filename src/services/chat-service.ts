import {and, asc, desc, eq} from 'drizzle-orm'
import {BaseAgent} from '../agent/base-agent.js'
import type {AgentConfig, AgentEvent} from '../agent/types/agent.js'
import {createApiError} from '../api/errors/api-error.js'
import {env} from '../config/env.js'
import {db} from '../db/index.js'
import {agents, conversations, messages} from '../db/schema.js'
import type {LLMMessage, LLMUsage} from '../llm/domain/llm-provider.js'
import {AISDKProviderAdapter} from '../llm/providers/ai-sdk-provider.js'
import {resolveModel} from '../llm/registry/model-registry.js'
import {providerRegistry} from '../llm/registry/provider-registry.js'
import {resolveBuiltinTools} from '../tools/builtin/index.js'
import {ToolRegistry} from '../tools/registry/tool-registry.js'
import {findUserAgent} from './agent-service.js'
import {acquireChatExecutionLease, type ConcurrencyLease} from './chat-concurrency-service.js'

const HISTORY_MESSAGE_LIMIT = 50

export interface ChatInput {
    userId: string
    agentId: string
    message: string
    sessionId?: string
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
    toolCalls: Array<Omit<ToolCallRecord, 'id'>>
}

export type ChatStreamEvent =
    | {type: 'text-delta'; content: string}
    | {type: 'tool-call'; id: string; name: string; args: unknown}
    | {type: 'tool-result'; id: string; name: string; result: unknown}
    | {type: 'finish'; usage?: LLMUsage}
    | {type: 'done'; sessionId: string}

interface PreparedExecution {
    agent: BaseAgent
    conversation: typeof conversations.$inferSelect
    history: LLMMessage[]
    lease: ConcurrencyLease
}

function publicExecutionError(error?: Error): string {
    return env.isProduction
        ? 'Agent execution failed'
        : error?.message ?? 'Agent execution failed'
}

function createAgentFromConfig(agentRow: typeof agents.$inferSelect): BaseAgent {
    const selectedTools = resolveBuiltinTools(agentRow.tools)
    const modelId = resolveModel(agentRow.modelProfile)
    const config: AgentConfig = {
        name: agentRow.name,
        description: agentRow.description ?? '',
        systemPrompt: agentRow.systemPrompt ?? 'You are a helpful assistant.',
        modelProfile: agentRow.modelProfile,
        modelId,
        maxSteps: agentRow.maxSteps,
    }
    const model = providerRegistry.languageModel(modelId as any)

    return new (class extends BaseAgent {
        getTools() {
            return selectedTools
        }
    })(config, new AISDKProviderAdapter(model), new ToolRegistry())
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
        .orderBy(desc(messages.createdAt))
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

function applyAgentEvent(
    event: AgentEvent,
    state: {reply: string; toolCalls: ToolCallRecord[]},
): void {
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
    }
}

async function persistAssistantMessage(
    conversationId: string,
    state: {reply: string; toolCalls: ToolCallRecord[]},
): Promise<void> {
    if (!state.reply && state.toolCalls.length === 0) return

    await db.insert(messages).values({
        conversationId,
        role: 'assistant',
        content: state.reply || null,
        toolCalls: state.toolCalls.length > 0 ? state.toolCalls : null,
    })
}

async function prepareExecution(input: ChatInput): Promise<PreparedExecution> {
    const agentRow = await findUserAgent(input.userId, input.agentId)
    const conversation = await getOrCreateConversation(
        input.userId,
        input.agentId,
        input.sessionId,
    )
    const lease = acquireChatExecutionLease(input.userId, conversation.sessionId)

    try {
        const history = await loadConversationHistory(conversation.id)
        await db.insert(messages).values({
            conversationId: conversation.id,
            role: 'user',
            content: input.message,
        })

        return {
            agent: createAgentFromConfig(agentRow),
            conversation,
            history,
            lease,
        }
    } catch (error) {
        lease.release()
        throw error
    }
}

export async function executeChat(input: ChatInput): Promise<ChatResult> {
    const execution = await prepareExecution(input)
    const state = {reply: '', toolCalls: [] as ToolCallRecord[]}

    try {
        for await (const event of execution.agent.run(input.message, {
            history: execution.history,
            abortSignal: input.abortSignal,
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

        await persistAssistantMessage(execution.conversation.id, state)
        return {
            reply: state.reply,
            sessionId: execution.conversation.sessionId,
            toolCalls: state.toolCalls.map(({id: _id, ...call}) => call),
        }
    } finally {
        execution.lease.release()
    }
}

export async function *streamChat(input: ChatInput): AsyncGenerator<ChatStreamEvent> {
    const execution = await prepareExecution(input)
    const state = {reply: '', toolCalls: [] as ToolCallRecord[]}
    let failed = false

    try {
        for await (const event of execution.agent.run(input.message, {
            history: execution.history,
            abortSignal: input.abortSignal,
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
                failed = true
                throw createApiError(
                    502,
                    'AGENT_EXECUTION_FAILED',
                    publicExecutionError(event.error),
                )
            }
        }

        await persistAssistantMessage(execution.conversation.id, state)
        if (!failed && !input.abortSignal?.aborted) {
            yield {type: 'done', sessionId: execution.conversation.sessionId}
        }
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
        .orderBy(asc(messages.createdAt))

    return items.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content ?? undefined,
        toolCalls: message.toolCalls ?? undefined,
        createdAt: message.createdAt.toISOString(),
    }))
}
