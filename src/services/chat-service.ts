import {and, asc, desc, eq} from 'drizzle-orm'
import type {AgentEvent} from '../agent/types/agent.js'
import {
    defaultAgentRuntimeFactory,
    type AgentRuntimeDescriptor,
} from '../agent/runtime/agent-runtime-factory.js'
import {createApiError} from '../api/errors/api-error.js'
import {env} from '../config/env.js'
import {db} from '../db/index.js'
import {agents, conversations, messages} from '../db/schema.js'
import type {LLMMessage, LLMUsage} from '../llm/domain/llm-provider.js'
import {findUserAgent} from './agent-service.js'
import {toAgentExecutionApiError} from './agent-execution-error.js'
import {
    buildTurnMessageRows,
    restoreLLMMessages,
    type PersistedToolCall,
} from './chat-message-mapper.js'
import {acquireChatExecutionLease, type ConcurrencyLease} from './chat-concurrency-service.js'

const HISTORY_MESSAGE_LIMIT = 50
const HISTORY_QUERY_LIMIT = HISTORY_MESSAGE_LIMIT * 3

export interface ChatInput {
    userId: string
    agentId: string
    message: string
    sessionId?: string
    abortSignal?: AbortSignal
}

export interface ToolCallRecord extends PersistedToolCall {}

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
    runtime: AgentRuntimeDescriptor
    conversation: typeof conversations.$inferSelect
    history: LLMMessage[]
    normalizedMessage: string
    lease: ConcurrencyLease
}

interface ExecutionState {
    reply: string
    toolCalls: ToolCallRecord[]
    completedToolCallIds: Set<string>
    finished: boolean
}

function createExecutionState(): ExecutionState {
    return {
        reply: '',
        toolCalls: [],
        completedToolCallIds: new Set<string>(),
        finished: false,
    }
}

function createRuntime(agentRow: typeof agents.$inferSelect): AgentRuntimeDescriptor {
    try {
        return defaultAgentRuntimeFactory.create({
            name: agentRow.name,
            description: agentRow.description,
            systemPrompt: agentRow.systemPrompt,
            modelProfile: agentRow.modelProfile,
            maxSteps: agentRow.maxSteps,
            tools: agentRow.tools,
        })
    } catch (error) {
        throw createApiError(
            500,
            'INVALID_AGENT_RUNTIME_CONFIGURATION',
            env.isProduction
                ? 'Agent runtime configuration is invalid'
                : error instanceof Error ? error.message : 'Agent runtime configuration is invalid',
        )
    }
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
        .onConflictDoNothing({target: [conversations.userId, conversations.sessionId]})
        .returning()

    if (created) return created

    const concurrent = await findConversationBySession(userId, resolvedSessionId)
    if (!concurrent) {
        throw createApiError(500, 'CONVERSATION_CREATE_FAILED', 'Failed to create conversation')
    }

    return ensureConversationAgent(concurrent, agentId)
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
        .limit(HISTORY_QUERY_LIMIT)

    return restoreLLMMessages(recentMessages.reverse()).slice(-HISTORY_MESSAGE_LIMIT)
}

function applyAgentEvent(event: AgentEvent, state: ExecutionState): void {
    if (event.type === 'text-delta') {
        state.reply += event.text ?? ''
        return
    }

    if (event.type === 'tool-call' && event.toolCall) {
        if (state.toolCalls.some((item) => item.id === event.toolCall?.id)) {
            throw new Error(`Duplicate tool call received by Chat runtime: ${event.toolCall.id}`)
        }
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
        if (!call) throw new Error(`Tool result has no matching call: ${event.toolResult.toolCallId}`)
        if (state.completedToolCallIds.has(call.id)) {
            throw new Error(`Tool result was received more than once: ${call.id}`)
        }
        call.result = event.toolResult.result
        state.completedToolCallIds.add(call.id)
        return
    }

    if (event.type === 'finish') state.finished = true
}

function assertExecutionComplete(state: ExecutionState): void {
    const incomplete = state.toolCalls
        .filter((call) => !state.completedToolCallIds.has(call.id))
        .map((call) => call.id)

    if (incomplete.length > 0) {
        throw new Error(`Agent finished with incomplete tool calls: ${incomplete.join(', ')}`)
    }
    if (!state.finished) throw new Error('Agent stream ended without a finish event')
    if (!state.reply.trim() && state.toolCalls.length === 0) {
        throw new Error('Agent produced no assistant response')
    }
}

async function persistConversationTurn(
    conversationId: string,
    userMessage: string,
    state: ExecutionState,
): Promise<void> {
    assertExecutionComplete(state)
    const rows = buildTurnMessageRows(conversationId, userMessage, state.reply, state.toolCalls)
    await db.transaction(async (tx) => {
        await tx.insert(messages).values(rows)
    })
}

async function prepareExecution(input: ChatInput): Promise<PreparedExecution> {
    const normalizedMessage = input.message.trim()
    if (!normalizedMessage) throw createApiError(400, 'EMPTY_MESSAGE', 'Message cannot be empty')
    if (input.abortSignal?.aborted) {
        throw createApiError(499, 'REQUEST_ABORTED', 'Request was aborted before execution')
    }

    const agentRow = await findUserAgent(input.userId, input.agentId)
    const conversation = await getOrCreateConversation(input.userId, input.agentId, input.sessionId)
    const lease = await acquireChatExecutionLease(input.userId, conversation.sessionId)

    try {
        return {
            runtime: createRuntime(agentRow),
            conversation,
            history: await loadConversationHistory(conversation.id),
            normalizedMessage,
            lease,
        }
    } catch (error) {
        await lease.release()
        throw error
    }
}

export async function executeChat(input: ChatInput): Promise<ChatResult> {
    const execution = await prepareExecution(input)
    const state = createExecutionState()

    try {
        for await (const event of execution.runtime.agent.run(execution.normalizedMessage, {
            history: execution.history,
            abortSignal: input.abortSignal,
            toolContext: {userId: input.userId, sessionId: execution.conversation.sessionId},
        })) {
            try {
                applyAgentEvent(event, state)
            } catch (error) {
                throw toAgentExecutionApiError(error instanceof Error ? error : new Error(String(error)))
            }
            if (event.type === 'error') throw toAgentExecutionApiError(event.error)
        }

        if (input.abortSignal?.aborted) {
            throw createApiError(499, 'REQUEST_ABORTED', 'Request was aborted during execution')
        }

        try {
            await persistConversationTurn(execution.conversation.id, execution.normalizedMessage, state)
        } catch (error) {
            throw toAgentExecutionApiError(error instanceof Error ? error : new Error(String(error)))
        }
        return {
            reply: state.reply,
            sessionId: execution.conversation.sessionId,
            toolCalls: state.toolCalls.map(({id: _id, ...call}) => call),
        }
    } finally {
        await execution.lease.release()
    }
}

export async function *streamChat(input: ChatInput): AsyncGenerator<ChatStreamEvent> {
    const execution = await prepareExecution(input)
    const state = createExecutionState()

    try {
        for await (const event of execution.runtime.agent.run(execution.normalizedMessage, {
            history: execution.history,
            abortSignal: input.abortSignal,
            toolContext: {userId: input.userId, sessionId: execution.conversation.sessionId},
        })) {
            try {
                applyAgentEvent(event, state)
            } catch (error) {
                throw toAgentExecutionApiError(error instanceof Error ? error : new Error(String(error)))
            }

            if (event.type === 'text-delta') {
                yield {type: 'text-delta', content: event.text ?? ''}
            } else if (event.type === 'tool-call' && event.toolCall) {
                yield {type: 'tool-call', id: event.toolCall.id, name: event.toolCall.name, args: event.toolCall.input}
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
                throw toAgentExecutionApiError(event.error)
            }
        }

        if (input.abortSignal?.aborted) return

        try {
            await persistConversationTurn(execution.conversation.id, execution.normalizedMessage, state)
        } catch (error) {
            throw toAgentExecutionApiError(error instanceof Error ? error : new Error(String(error)))
        }
        yield {type: 'done', sessionId: execution.conversation.sessionId}
    } finally {
        await execution.lease.release()
    }
}

export async function getChatHistory(userId: string, sessionId: string) {
    const conversation = await findConversationBySession(userId, sessionId)
    if (!conversation) throw createApiError(404, 'SESSION_NOT_FOUND', 'Session not found')

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
