import {and, asc, desc, eq} from 'drizzle-orm'
import {BaseAgent} from '../agent/base-agent.js'
import type {AgentConfig, AgentEvent} from '../agent/types/agent.js'
import {createApiError} from '../api/errors/api-error.js'
import {inferAgentKeyFromTools, resolveAgentTools} from '../agents/catalog.js'
import {env} from '../config/env.js'
import {db} from '../db/index.js'
import {agents, conversations, messages} from '../db/schema.js'
import type {LLMMessage, LLMUsage} from '../llm/domain/llm-provider.js'
import {AISDKProviderAdapter} from '../llm/providers/ai-sdk-provider.js'
import {resolveModel} from '../llm/registry/model-registry.js'
import {resolveLanguageModel} from '../llm/registry/provider-registry.js'
import {ToolRegistry} from '../tools/registry/tool-registry.js'
import {findUserAgent} from './agent-service.js'
import {
    buildTurnMessageRows,
    restoreLLMMessages,
    type PersistedToolCall,
} from './chat-message-mapper.js'
import {acquireChatExecutionLease, type ConcurrencyLease} from './chat-concurrency-service.js'

const HISTORY_MESSAGE_LIMIT = 50

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
    let selectedTools
    try {
        const agentKey = inferAgentKeyFromTools(agentRow.tools)
        selectedTools = resolveAgentTools(agentKey, agentRow.tools)
    } catch (error) {
        throw createApiError(
            500,
            'INVALID_AGENT_TOOL_CONFIGURATION',
            env.isProduction
                ? 'Agent tool configuration is invalid'
                : error instanceof Error ? error.message : 'Agent tool configuration is invalid',
        )
    }

    const modelId = resolveModel(agentRow.modelProfile)
    const config: AgentConfig = {
        name: agentRow.name,
        description: agentRow.description ?? '',
        systemPrompt: agentRow.systemPrompt ?? 'You are a helpful assistant.',
        modelProfile: agentRow.modelProfile,
        modelId,
        maxSteps: agentRow.maxSteps,
        tools: selectedTools,
    }

    return new BaseAgent(config, new AISDKProviderAdapter(resolveLanguageModel), new ToolRegistry())
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

    return restoreLLMMessages(recentMessages.reverse())
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
        if (!call) {
            throw new Error(`Tool result has no matching call: ${event.toolResult.toolCallId}`)
        }
        call.result = event.toolResult.result
    }
}

async function persistConversationTurn(
    conversationId: string,
    userMessage: string,
    state: {reply: string; toolCalls: ToolCallRecord[]},
): Promise<void> {
    const rows = buildTurnMessageRows(
        conversationId,
        userMessage,
        state.reply,
        state.toolCalls,
    )

    await db.transaction(async (tx) => {
        await tx.insert(messages).values(rows)
    })
}

async function prepareExecution(input: ChatInput): Promise<PreparedExecution> {
    const normalizedMessage = input.message.trim()
    if (!normalizedMessage) {
        throw createApiError(400, 'EMPTY_MESSAGE', 'Message cannot be empty')
    }
    if (input.abortSignal?.aborted) {
        throw createApiError(499, 'REQUEST_ABORTED', 'Request was aborted before execution')
    }

    const agentRow = await findUserAgent(input.userId, input.agentId)
    const conversation = await getOrCreateConversation(
        input.userId,
        input.agentId,
        input.sessionId,
    )
    const lease = acquireChatExecutionLease(input.userId, conversation.sessionId)

    try {
        const history = await loadConversationHistory(conversation.id)
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

        if (input.abortSignal?.aborted) {
            throw createApiError(499, 'REQUEST_ABORTED', 'Request was aborted during execution')
        }

        await persistConversationTurn(execution.conversation.id, input.message.trim(), state)
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
                throw createApiError(
                    502,
                    'AGENT_EXECUTION_FAILED',
                    publicExecutionError(event.error),
                )
            }
        }

        if (input.abortSignal?.aborted) return

        await persistConversationTurn(execution.conversation.id, input.message.trim(), state)
        yield {type: 'done', sessionId: execution.conversation.sessionId}
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