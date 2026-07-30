import {t} from 'elysia'

export const registerBody = t.Object({
    username: t.String({minLength: 2, maxLength: 50}),
    email: t.String({format: 'email'}),
    password: t.String({minLength: 6}),
})

export const loginBody = t.Object({
    email: t.String({format: 'email'}),
    password: t.String(),
})

export const refreshBody = t.Object({
    token: t.String(),
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
