import {Elysia, t} from 'elysia'
import {eq} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {agents, conversations, messages} from '../../db/schema.js'
import {chatBody, chatStreamBody, chatResponse} from '../schemas/chat.js'
import {authPlugin} from '../middleware/auth.js'
import {BaseAgent} from '../../agent/base-agent.js'
import {AISDKProviderAdapter} from '../../llm/providers/ai-sdk-provider.js'
import {providerRegistry} from '../../llm/registry/provider-registry.js'
import {resolveModel} from '../../llm/registry/model-registry.js'
import {ToolRegistry} from '../../tools/registry/tool-registry.js'
import {calculatorTool} from '../../tools/builtin/calculator.tool.js'
import {currentTimeTool} from '../../tools/builtin/current-time.tool.js'
import type {AgentConfig} from '../../agent/types/agent.js'

const builtinTools = [calculatorTool, currentTimeTool]

async function requireUser(JWT: any, auth: any) {
    if (!auth?.value) throw new Error('Unauthorized')
    const payload = await JWT.verify(auth.value)
    if (!payload) throw new Error('Unauthorized')
    return payload as {sub: string; username: string}
}

function createAgentFromConfig(agentRow: any): BaseAgent {
    const toolNames = (agentRow.tools as string[] | null) ?? []
    const selectedTools = builtinTools.filter((t) => toolNames.includes(t.name))
    const config: AgentConfig = {
        name: agentRow.name, description: agentRow.description ?? '',
        systemPrompt: agentRow.systemPrompt ?? 'You are a helpful assistant.',
        modelProfile: agentRow.modelProfile, maxSteps: agentRow.maxSteps,
    }
    const modelId = resolveModel(config.modelProfile)
    const colonIndex = modelId.indexOf(':')
    const providerName = colonIndex > -1 ? modelId.substring(0, colonIndex) : modelId
    const modelName = colonIndex > -1 ? modelId.substring(colonIndex + 1) : modelId
    const rawProvider = (providerRegistry as any)[providerName]
    if (!rawProvider) throw new Error(`Unknown provider: ${providerName}`)
    const model = rawProvider(modelName)
    const llmProvider = new AISDKProviderAdapter(model)
    const toolRegistry = new ToolRegistry()
    return new (class extends BaseAgent { getTools() { return selectedTools } })(config, llmProvider, toolRegistry)
}

async function getOrCreateConversation(userId: string, agentId: string, sessionId?: string) {
    const sid = sessionId ?? crypto.randomUUID()
    const [existing] = await db.select().from(conversations).where(eq(conversations.userId, userId)).limit(1)
    if (existing) return {conversation: existing, sessionId: sid}
    const [conv] = await db.insert(conversations).values({userId, agentId, sessionId: sid}).returning()
    return {conversation: conv!, sessionId: sid}
}

export const chatRoutes = new Elysia({prefix: '/chat'})
    .use(authPlugin)
    .post(
        '/',
        // @ts-ignore
        async ({body, JWT, cookie: {auth}}) => {
            const user = await requireUser(JWT, auth)
            const [agentRow] = await db.select().from(agents).where(eq(agents.id, body.agentId)).limit(1)
            if (!agentRow) return new Response(JSON.stringify({success: false, error: {code: 'AGENT_NOT_FOUND', message: 'Agent not found'}}), {status: 404, headers: {'Content-Type': 'application/json'}})

            const {conversation, sessionId} = await getOrCreateConversation(user.sub, body.agentId, body.sessionId)
            await db.insert(messages).values({conversationId: conversation.id, role: 'user', content: body.message})

            const agent = createAgentFromConfig(agentRow)
            let reply = ''
            const toolCalls: {name: string; args: unknown; result: unknown}[] = []

            for await (const event of agent.run(body.message)) {
                if (event.type === 'text-delta') reply += event.text ?? ''
                else if (event.type === 'tool-call') toolCalls.push({name: event.toolCall!.name, args: event.toolCall!.input, result: null})
                else if (event.type === 'tool-result') {
                    const last = toolCalls.find((t) => t.name === event.toolResult!.name)
                    if (last) last.result = event.toolResult!.result
                }
            }

            await db.insert(messages).values({conversationId: conversation.id, role: 'assistant', content: reply, toolCalls: toolCalls.length > 0 ? toolCalls : null})
            return {success: true, data: {reply, sessionId, toolCalls}}
        },
        {body: chatBody, detail: {summary: 'Chat (JSON)', security: [{BearerAuth: []}]}},
    )
    .post(
        '/stream',
        // @ts-ignore
        async ({body, JWT, cookie: {auth}}) => {
            const user = await requireUser(JWT, auth)
            const [agentRow] = await db.select().from(agents).where(eq(agents.id, body.agentId)).limit(1)
            if (!agentRow) return new Response(JSON.stringify({success: false, error: {code: 'AGENT_NOT_FOUND', message: 'Agent not found'}}), {status: 404, headers: {'Content-Type': 'application/json'}})

            const {conversation, sessionId} = await getOrCreateConversation(user.sub, body.agentId, body.sessionId)
            await db.insert(messages).values({conversationId: conversation.id, role: 'user', content: body.message})
            const agent = createAgentFromConfig(agentRow)

            const encoder = new TextEncoder()
            const sseStream = new ReadableStream({
                async start(controller) {
                    let reply = ''
                    const toolCalls: {name: string; args: unknown; result: unknown}[] = []
                    for await (const event of agent.run(body.message)) {
                        if (event.type === 'text-delta') {
                            reply += event.text ?? ''
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'text-delta', content: event.text})}\n\n`))
                        } else if (event.type === 'tool-call') {
                            toolCalls.push({name: event.toolCall!.name, args: event.toolCall!.input, result: null})
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'tool-call', name: event.toolCall!.name, args: event.toolCall!.input})}\n\n`))
                        } else if (event.type === 'tool-result') {
                            const last = toolCalls.find((t) => t.name === event.toolResult!.name)
                            if (last) last.result = event.toolResult!.result
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'tool-result', name: event.toolResult!.name, result: event.toolResult!.result})}\n\n`))
                        } else if (event.type === 'finish') {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'finish', usage: event.usage})}\n\n`))
                        }
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                    await db.insert(messages).values({conversationId: conversation.id, role: 'assistant', content: reply, toolCalls: toolCalls.length > 0 ? toolCalls : null})
                    controller.close()
                },
            })
            return new Response(sseStream, {headers: {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'}})
        },
        {body: chatStreamBody, detail: {summary: 'Chat (SSE)', security: [{BearerAuth: []}]}},
    )
    .get(
        '/history/:sessionId',
        // @ts-ignore
        async ({params, JWT, cookie: {auth}}) => {
            const user = await requireUser(JWT, auth)
            const [conv] = await db.select().from(conversations).where(eq(conversations.sessionId, params.sessionId)).limit(1)
            if (!conv) return new Response(JSON.stringify({success: false, error: {code: 'NOT_FOUND', message: 'Session not found'}}), {status: 404, headers: {'Content-Type': 'application/json'}})
            const items = await db.select().from(messages).where(eq(messages.conversationId, conv.id))
            return {success: true, data: items.map((m) => ({id: m.id, role: m.role, content: m.content ?? undefined, toolCalls: m.toolCalls ?? undefined, createdAt: m.createdAt.toISOString()}))}
        },
        {params: t.Object({sessionId: t.String()}), detail: {summary: 'Get chat history', security: [{BearerAuth: []}]}},
    )
