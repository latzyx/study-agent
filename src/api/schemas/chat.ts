import {t} from 'elysia'

export const chatBody = t.Object({
    agentId: t.String(),
    message: t.String({minLength: 1}),
    sessionId: t.Optional(t.String()),
})

export const chatStreamBody = t.Object({
    agentId: t.String(),
    message: t.String({minLength: 1}),
    sessionId: t.Optional(t.String()),
})

export const chatResponse = t.Object({
    success: t.Boolean(),
    data: t.Object({
        reply: t.String(),
        sessionId: t.String(),
        toolCalls: t.Array(
            t.Object({
                name: t.String(),
                args: t.Unknown(),
                result: t.Unknown(),
            }),
        ),
    }),
})

export const messageResponse = t.Object({
    id: t.String(),
    role: t.String(),
    content: t.Optional(t.String()),
    toolCalls: t.Optional(t.Unknown()),
    createdAt: t.String(),
})

export const historyParams = t.Object({
    sessionId: t.String(),
})
