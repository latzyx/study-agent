import {t} from 'elysia'

export const createAgentBody = t.Object({
    name: t.String({minLength: 1, maxLength: 100}),
    description: t.Optional(t.String()),
    systemPrompt: t.Optional(t.String()),
    modelProfile: t.Optional(
        t.Union(
            [
                t.Literal('fast'),
                t.Literal('general'),
                t.Literal('reasoning'),
                t.Literal('vision'),
            ],
            {default: 'general'},
        ),
    ),
    maxSteps: t.Optional(t.Number({minimum: 1, maximum: 50, default: 5})),
    tools: t.Optional(t.Array(t.String())),
})

export const updateAgentBody = t.Object({
    name: t.Optional(t.String({minLength: 1, maxLength: 100})),
    description: t.Optional(t.String()),
    systemPrompt: t.Optional(t.String()),
    modelProfile: t.Optional(
        t.Union([
            t.Literal('fast'),
            t.Literal('general'),
            t.Literal('reasoning'),
            t.Literal('vision'),
        ]),
    ),
    maxSteps: t.Optional(t.Number({minimum: 1, maximum: 50})),
    tools: t.Optional(t.Array(t.String())),
})

export const agentResponse = t.Object({
    id: t.String(),
    name: t.String(),
    description: t.Optional(t.String()),
    systemPrompt: t.Optional(t.String()),
    modelProfile: t.String(),
    maxSteps: t.Number(),
    tools: t.Array(t.String()),
    createdBy: t.Optional(t.String()),
    createdAt: t.String(),
    updatedAt: t.String(),
})

export const agentListQuery = t.Object({
    page: t.Optional(t.Number({default: 1})),
    pageSize: t.Optional(t.Number({default: 20, maximum: 100})),
})
