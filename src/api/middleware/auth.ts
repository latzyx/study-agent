import {Elysia} from 'elysia'
import {jwt} from '@elysiajs/jwt'
import {env} from '../../config/env.js'

export interface AccessTokenPayload {
    sub: string
    username?: string
}

interface JwtVerifier {
    verify(token: string): Promise<Record<string, unknown> | false>
}

function resolveBearerToken(authorization?: string): string | null {
    const match = authorization?.match(/^Bearer\s+(.+)$/i)
    const token = match?.[1]?.trim()
    return token ? token : null
}

export async function authenticateAccessToken(
    JWT: JwtVerifier,
    authorization?: string,
): Promise<AccessTokenPayload | null> {
    const token = resolveBearerToken(authorization)
    if (!token) return null

    const payload = await JWT.verify(token)
    if (!payload || payload.type !== 'access' || typeof payload.sub !== 'string') return null

    return {
        sub: payload.sub,
        username: typeof payload.username === 'string' ? payload.username : undefined,
    }
}

export function hasAdminAccess(user: AccessTokenPayload): boolean {
    return env.auth.adminUserIds.has(user.sub)
        || (typeof user.username === 'string' && env.auth.adminUsernames.has(user.username))
}

export function unauthorizedResponse(): Response {
    return Response.json(
        {success: false, error: {code: 'UNAUTHORIZED', message: 'Authentication required'}},
        {status: 401},
    )
}

export function forbiddenResponse(message = 'Insufficient permissions'): Response {
    return Response.json(
        {success: false, error: {code: 'FORBIDDEN', message}},
        {status: 403},
    )
}

export const authPlugin = new Elysia({name: 'auth-plugin'})
    .use(jwt({
        name: 'JWT',
        secret: env.auth.jwtSecret,
    }))
