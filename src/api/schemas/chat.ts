import {t} from 'elysia'

const chatRequestBody = t.Object({
    agentId: t.String({format: 'uuid'}),
    message: t.String({minLength: 1, maxLength: 20_000}),
    sessionId: t.Optional(t.String({minLength: 1, maxLength: 100})),
})

export const chatBody = chatRequestBody
export const chatStreamBody = chatRequestBody

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
    sessionId: t.String({minLength: 1, maxLength: 100}),
})
