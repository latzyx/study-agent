import {t} from 'elysia'

export const registerBody = t.Object({
    username: t.String({minLength: 2, maxLength: 50, pattern: '^[A-Za-z0-9_.-]+$'}),
    email: t.String({format: 'email', maxLength: 100}),
    password: t.String({minLength: 8, maxLength: 200}),
})

export const loginBody = t.Object({
    email: t.String({format: 'email', maxLength: 100}),
    password: t.String({minLength: 1, maxLength: 200}),
})

export const refreshBody = t.Object({
    token: t.String({minLength: 1, maxLength: 4096}),
})

export const authResponse = t.Object({
    user: t.Object({
        id: t.String(),
        username: t.String(),
        email: t.String(),
    }),
    token: t.String(),
    refreshToken: t.String(),
})
