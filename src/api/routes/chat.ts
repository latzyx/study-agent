import {Elysia, t} from 'elysia'
import {ApiError} from '../errors/api-error.js'
import {env} from '../../config/env.js'
import {
    executeChat,
    getChatHistory,
    streamChat,
} from '../../services/chat-service.js'
import {
    getAiTrace,
    listAiTraces,
} from '../../services/ai-trace-service.js'
import {enforceChatRateLimit} from '../../services/request-guard-service.js'
import {authPlugin, requireAccessToken} from '../middleware/auth.js'
import {getRequestId} from '../middleware/request-context.js'
import {chatBody, chatStreamBody} from '../schemas/chat.js'

const traceListQuery = t.Object({
    page: t.Optional(t.Number({default: 1, minimum: 1})),
    pageSize: t.Optional(t.Number({default: 20, minimum: 1, maximum: 100})),
    sessionId: t.Optional(t.String({minLength: 1, maxLength: 100})),
    agentId: t.Optional(t.String({format: 'uuid'})),
    status: t.Optional(t.Union([
        t.Literal('running'),
        t.Literal('success'),
        t.Literal('error'),
        t.Literal('aborted'),
    ])),
})

function streamErrorPayload(error: unknown) {
    if (error instanceof ApiError) {
        return {
            type: 'error',
            code: error.code,
            message: error.message,
            ...(error.details ? {details: error.details} : {}),
        }
    }

    return {
        type: 'error',
        code: 'STREAM_FAILED',
        message: env.isProduction
            ? 'Streaming response failed'
            : error instanceof Error ? error.message : String(error),
    }
}

export const chatRoutes = new Elysia({prefix: '/chat'})
    .use(authPlugin)
    .post(
        '/',
        async ({body, JWT, headers, request}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            enforceChatRateLimit(user.sub)

            const result = await executeChat({
                userId: user.sub,
                agentId: body.agentId,
                message: body.message,
                sessionId: body.sessionId,
                requestId: getRequestId(request),
                abortSignal: request.signal,
            })

            return {success: true, data: result}
        },
        {body: chatBody, detail: {summary: 'Chat (JSON)', security: [{BearerAuth: []}]}},
    )
    .post(
        '/stream',
        async ({body, JWT, headers, request}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            enforceChatRateLimit(user.sub)
            const requestId = getRequestId(request)

            const encoder = new TextEncoder()
            const stream = new ReadableStream({
                async start(controller) {
                    const send = (data: unknown) => {
                        if (request.signal.aborted) return
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                    }

                    try {
                        for await (const event of streamChat({
                            userId: user.sub,
                            agentId: body.agentId,
                            message: body.message,
                            sessionId: body.sessionId,
                            requestId,
                            abortSignal: request.signal,
                        })) {
                            send(event)
                        }
                    } catch (error) {
                        if (!request.signal.aborted) send(streamErrorPayload(error))
                    } finally {
                        if (!request.signal.aborted) controller.close()
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
        '/traces',
        async ({query, JWT, headers}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const result = await listAiTraces({
                userId: user.sub,
                page,
                pageSize,
                sessionId: query.sessionId,
                agentId: query.agentId,
                status: query.status,
            })

            return {
                success: true,
                data: result.items,
                pagination: {page, pageSize, total: result.total},
            }
        },
        {
            query: traceListQuery,
            detail: {summary: 'List current user AI traces', security: [{BearerAuth: []}]},
        },
    )
    .get(
        '/traces/:traceId',
        async ({params, JWT, headers}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            return {
                success: true,
                data: await getAiTrace(user.sub, params.traceId),
            }
        },
        {
            params: t.Object({traceId: t.String({format: 'uuid'})}),
            detail: {summary: 'Get AI trace with spans', security: [{BearerAuth: []}]},
        },
    )
    .get(
        '/history/:sessionId',
        async ({params, JWT, headers}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            return {
                success: true,
                data: await getChatHistory(user.sub, params.sessionId),
            }
        },
        {
            params: t.Object({sessionId: t.String({minLength: 1, maxLength: 100})}),
            detail: {summary: 'Get chat history', security: [{BearerAuth: []}]},
        },
    )
