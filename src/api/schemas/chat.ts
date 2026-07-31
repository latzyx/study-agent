import {t} from 'elysia'

const builtinAgentKey = t.Union([
    t.Literal('general'),
    t.Literal('math'),
    t.Literal('time'),
])

const chatRequestBody = t.Object({
    agentId: t.Optional(t.String({format: 'uuid'})),
    agentKey: t.Optional(builtinAgentKey),
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
        agentId: t.String({format: 'uuid'}),
        agentKey: builtinAgentKey,
        runtimeFingerprint: t.String({minLength: 64, maxLength: 64}),
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
