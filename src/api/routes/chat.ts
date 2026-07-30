import {Elysia, t} from 'elysia'
import {and, asc, desc, eq} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {agents, conversations, messages} from '../../db/schema.js'
import {chatBody, chatStreamBody} from '../schemas/chat.js'
import {
    authenticateAccessToken,
    authPlugin,
    unauthorizedResponse,
} from '../middleware/auth.js'
import {BaseAgent} from '../../agent/base-agent.js'
import {AISDKProviderAdapter} from '../../llm/providers/ai-sdk-provider.js'
import {providerRegistry} from '../../llm/registry/provider-registry.js'
import {resolveModel} from '../../llm/registry/model-registry.js'
import {ToolRegistry} from '../../tools/registry/tool-registry.js'
import {calculatorTool} from '../../tools/builtin/calculator.tool.js'
import {currentTimeTool} from '../../tools/builtin/current-time.tool.js'
import type {AgentConfig, AgentEvent} from '../../agent/types/agent.js'
import type {LLMMessage} from '../../llm/domain/llm-provider.js'

const builtinTools = [calculatorTool, currentTimeTool]
const HISTORY_MESSAGE_LIMIT = 50

type ToolCallRecord = {
    id: string
    name: string
    args: unknown
    result: unknown
}

function apiError(status: number, code: string, message: string): Response {
    return Response.json({success: false, error: {code, message}}, {status})
}

function createAgentFromConfig(agentRow: typeof agents.$inferSelect): BaseAgent {
    const toolNames = agentRow.tools ?? []
    const selectedTools = builtinTools.filter((tool) => toolNames.includes(tool.name))
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
    const llmProvider = new AISDKProviderAdapter(model)
    const toolRegistry = new ToolRegistry()

    return new (class extends BaseAgent {
        getTools() {
            return selectedTools
        }
    })(config, llmProvider, toolRegistry)
}

async function findOwnedAgent(userId: string, agentId: string) {
    const [agent] = await db.select().from(agents).where(and(
        eq(agents.id, agentId),
        eq(agents.createdBy, userId),
    )).limit(1)

    return agent
}

async function getOrCreateConversation(userId: string, agentId: string, sessionId?: string) {
    const resolvedSessionId = sessionId?.trim() || crypto.randomUUID()
    const [existing] = await db.select().from(conversations).where(and(
        eq(conversations.userId, userId),
        eq(conversations.agentId, agentId),
        eq(conversations.sessionId, resolvedSessionId),
    )).limit(1)

    if (existing) return existing

    const [created] = await db.insert(conversations).values({
        userId,
        agentId,
        sessionId: resolvedSessionId,
    }).returning()

    if (!created) throw new Error('Failed to create conversation')
    return created
}

async function loadConversationHistory(conversationId: string): Promise<LLMMessage[]> {
    const recentMessages = await db.select({
        role: messages.role,
        content: messages.content,
    })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.createdAt))
        .limit(HISTORY_MESSAGE_LIMIT)

    return recentMessages
        .reverse()
        .filter((message) => typeof message.content === 'string' && message.content.length > 0)
        .map((message) => ({
            role: message.role,
            content: message.content!,
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

export const chatRoutes = new Elysia({prefix: '/chat'})
    .use(authPlugin)
    .post(
        '/',
        async ({body, JWT, headers, request}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const agentRow = await findOwnedAgent(user.sub, body.agentId)
            if (!agentRow) return apiError(404, 'AGENT_NOT_FOUND', 'Agent not found')

            const conversation = await getOrCreateConversation(user.sub, body.agentId, body.sessionId)
            const history = await loadConversationHistory(conversation.id)
            await db.insert(messages).values({
                conversationId: conversation.id,
                role: 'user',
                content: body.message,
            })

            const state = {reply: '', toolCalls: [] as ToolCallRecord[]}
            const agent = createAgentFromConfig(agentRow)

            for await (const event of agent.run(body.message, {
                history,
                abortSignal: request.signal,
                toolContext: {userId: user.sub, sessionId: conversation.sessionId},
            })) {
                applyAgentEvent(event, state)
                if (event.type === 'error') {
                    return apiError(502, 'AGENT_EXECUTION_FAILED', event.error?.message ?? 'Agent execution failed')
                }
            }

            await db.insert(messages).values({
                conversationId: conversation.id,
                role: 'assistant',
                content: state.reply,
                toolCalls: state.toolCalls.length > 0 ? state.toolCalls : null,
            })

            return {
                success: true,
                data: {
                    reply: state.reply,
                    sessionId: conversation.sessionId,
                    toolCalls: state.toolCalls.map(({id: _id, ...call}) => call),
                },
            }
        },
        {body: chatBody, detail: {summary: 'Chat (JSON)', security: [{BearerAuth: []}]}},
    )
    .post(
        '/stream',
        async ({body, JWT, headers, request}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const agentRow = await findOwnedAgent(user.sub, body.agentId)
            if (!agentRow) return apiError(404, 'AGENT_NOT_FOUND', 'Agent not found')

            const conversation = await getOrCreateConversation(user.sub, body.agentId, body.sessionId)
            const history = await loadConversationHistory(conversation.id)
            await db.insert(messages).values({
                conversationId: conversation.id,
                role: 'user',
                content: body.message,
            })

            const agent = createAgentFromConfig(agentRow)
            const encoder = new TextEncoder()
            const stream = new ReadableStream({
                async start(controller) {
                    const state = {reply: '', toolCalls: [] as ToolCallRecord[]}
                    let failed = false
                    const send = (data: unknown) => {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                    }

                    try {
                        for await (const event of agent.run(body.message, {
                            history,
                            abortSignal: request.signal,
                            toolContext: {userId: user.sub, sessionId: conversation.sessionId},
                        })) {
                            applyAgentEvent(event, state)

                            if (event.type === 'text-delta') {
                                send({type: 'text-delta', content: event.text})
                            } else if (event.type === 'tool-call' && event.toolCall) {
                                send({
                                    type: 'tool-call',
                                    id: event.toolCall.id,
                                    name: event.toolCall.name,
                                    args: event.toolCall.input,
                                })
                            } else if (event.type === 'tool-result' && event.toolResult) {
                                send({
                                    type: 'tool-result',
                                    id: event.toolResult.toolCallId,
                                    name: event.toolResult.name,
                                    result: event.toolResult.result,
                                })
                            } else if (event.type === 'finish') {
                                send({type: 'finish', usage: event.usage})
                            } else if (event.type === 'error') {
                                failed = true
                                send({
                                    type: 'error',
                                    code: 'AGENT_EXECUTION_FAILED',
                                    message: event.error?.message ?? 'Agent execution failed',
                                })
                                break
                            }
                        }

                        if (state.reply || state.toolCalls.length > 0) {
                            await db.insert(messages).values({
                                conversationId: conversation.id,
                                role: 'assistant',
                                content: state.reply,
                                toolCalls: state.toolCalls.length > 0 ? state.toolCalls : null,
                            })
                        }
                        if (!failed) send({type: 'done', sessionId: conversation.sessionId})
                    } catch (error) {
                        send({
                            type: 'error',
                            code: 'STREAM_FAILED',
                            message: error instanceof Error ? error.message : String(error),
                        })
                    } finally {
                        controller.close()
                    }
                },
            })

            return new Response(stream, {
                headers: {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache, no-transform',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no',
                },
            })
        },
        {body: chatStreamBody, detail: {summary: 'Chat (SSE)', security: [{BearerAuth: []}]}},
    )
    .get(
        '/history/:sessionId',
        async ({params, JWT, headers}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const [conversation] = await db.select().from(conversations).where(and(
                eq(conversations.sessionId, params.sessionId),
                eq(conversations.userId, user.sub),
            )).limit(1)
            if (!conversation) return apiError(404, 'NOT_FOUND', 'Session not found')

            const items = await db.select()
                .from(messages)
                .where(eq(messages.conversationId, conversation.id))
                .orderBy(asc(messages.createdAt))

            return {
                success: true,
                data: items.map((message) => ({
                    id: message.id,
                    role: message.role,
                    content: message.content ?? undefined,
                    toolCalls: message.toolCalls ?? undefined,
                    createdAt: message.createdAt.toISOString(),
                })),
            }
        },
        {
            params: t.Object({sessionId: t.String({minLength: 1, maxLength: 100})}),
            detail: {summary: 'Get chat history', security: [{BearerAuth: []}]},
        },
    )
