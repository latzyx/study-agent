import {Elysia} from 'elysia'
import {jwt} from '@elysiajs/jwt'

function resolveJwtSecret(): string {
    const secret = process.env.JWT_SECRET?.trim()
    if (secret) return secret

    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET must be configured in production')
    }

    console.warn('[auth] JWT_SECRET is not configured; using a development-only secret')
    return 'study-agent-dev-secret-change-me'
}

export const JWT_SECRET = resolveJwtSecret()

export interface AccessTokenPayload {
    sub: string
    username?: string
}

interface JwtVerifier {
    verify(token: string): Promise<Record<string, unknown> | false>
}

interface AuthCookie {
    value?: unknown
}

export async function authenticateAccessToken(
    JWT: JwtVerifier,
    auth?: AuthCookie,
): Promise<AccessTokenPayload | null> {
    if (typeof auth?.value !== 'string' || auth.value.length === 0) return null

    const payload = await JWT.verify(auth.value)
    if (!payload || payload.type === 'refresh' || typeof payload.sub !== 'string') return null

    return {
        sub: payload.sub,
        username: typeof payload.username === 'string' ? payload.username : undefined,
    }
}

export function unauthorizedResponse(): Response {
    return Response.json(
        {success: false, error: {code: 'UNAUTHORIZED', message: 'Authentication required'}},
        {status: 401},
    )
}

export const authPlugin = new Elysia({name: 'auth-plugin'})
    .use(
        jwt({
            name: 'JWT',
            secret: JWT_SECRET,
        }),
    )
