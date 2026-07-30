import {and, eq, gt, isNull} from 'drizzle-orm'
import {env} from '../config/env.js'
import {db} from '../db/index.js'
import {refreshTokens, users} from '../db/schema.js'
import {createApiError} from '../api/errors/api-error.js'

export interface JwtCodec {
    sign(payload: Record<string, unknown>): Promise<string>
    verify(token: string): Promise<Record<string, unknown> | false>
}

export interface TokenUser {
    id: string
    username: string
    email: string
}

export interface TokenPair {
    token: string
    refreshToken: string
}

async function hashToken(token: string): Promise<string> {
    const bytes = new TextEncoder().encode(token)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function unixNow(): number {
    return Math.floor(Date.now() / 1000)
}

async function signAccessToken(JWT: JwtCodec, user: TokenUser): Promise<string> {
    const now = unixNow()
    return JWT.sign({
        sub: user.id,
        username: user.username,
        type: 'access',
        jti: crypto.randomUUID(),
        iat: now,
        exp: now + env.auth.accessTokenTtlSeconds,
    })
}

async function signRefreshToken(
    JWT: JwtCodec,
    userId: string,
    tokenId: string,
    now: number,
): Promise<{token: string; expiresAt: Date}> {
    const expiresAtSeconds = now + env.auth.refreshTokenTtlSeconds
    const token = await JWT.sign({
        sub: userId,
        type: 'refresh',
        jti: tokenId,
        iat: now,
        exp: expiresAtSeconds,
    })

    return {
        token,
        expiresAt: new Date(expiresAtSeconds * 1000),
    }
}

export async function issueTokenPair(JWT: JwtCodec, user: TokenUser): Promise<TokenPair> {
    const now = unixNow()
    const tokenId = crypto.randomUUID()
    const [token, refresh] = await Promise.all([
        signAccessToken(JWT, user),
        signRefreshToken(JWT, user.id, tokenId, now),
    ])

    await db.insert(refreshTokens).values({
        id: tokenId,
        userId: user.id,
        tokenHash: await hashToken(refresh.token),
        expiresAt: refresh.expiresAt,
    })

    return {token, refreshToken: refresh.token}
}

function parseRefreshPayload(payload: Record<string, unknown> | false) {
    if (
        !payload
        || payload.type !== 'refresh'
        || typeof payload.sub !== 'string'
        || typeof payload.jti !== 'string'
    ) {
        throw createApiError(401, 'INVALID_TOKEN', 'Invalid refresh token')
    }

    return {userId: payload.sub, tokenId: payload.jti}
}

export async function rotateRefreshToken(
    JWT: JwtCodec,
    presentedToken: string,
): Promise<{user: TokenUser; tokens: TokenPair}> {
    const payload = parseRefreshPayload(await JWT.verify(presentedToken))
    const presentedHash = await hashToken(presentedToken)
    const nowDate = new Date()

    return db.transaction(async (tx) => {
        const [revoked] = await tx.update(refreshTokens)
            .set({revokedAt: nowDate})
            .where(and(
                eq(refreshTokens.id, payload.tokenId),
                eq(refreshTokens.userId, payload.userId),
                eq(refreshTokens.tokenHash, presentedHash),
                isNull(refreshTokens.revokedAt),
                gt(refreshTokens.expiresAt, nowDate),
            ))
            .returning({userId: refreshTokens.userId})

        if (!revoked) {
            throw createApiError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token is expired or already used')
        }

        const [user] = await tx.select({
            id: users.id,
            username: users.username,
            email: users.email,
        }).from(users).where(eq(users.id, revoked.userId)).limit(1)

        if (!user) throw createApiError(401, 'USER_NOT_FOUND', 'User not found')

        const now = unixNow()
        const nextTokenId = crypto.randomUUID()
        const [token, refresh] = await Promise.all([
            signAccessToken(JWT, user),
            signRefreshToken(JWT, user.id, nextTokenId, now),
        ])

        await tx.insert(refreshTokens).values({
            id: nextTokenId,
            userId: user.id,
            tokenHash: await hashToken(refresh.token),
            expiresAt: refresh.expiresAt,
        })

        return {
            user,
            tokens: {token, refreshToken: refresh.token},
        }
    })
}

export async function revokeRefreshToken(
    JWT: JwtCodec,
    presentedToken: string,
): Promise<boolean> {
    const verified = await JWT.verify(presentedToken)
    if (!verified) return false

    let payload: {userId: string; tokenId: string}
    try {
        payload = parseRefreshPayload(verified)
    } catch {
        return false
    }

    const [revoked] = await db.update(refreshTokens)
        .set({revokedAt: new Date()})
        .where(and(
            eq(refreshTokens.id, payload.tokenId),
            eq(refreshTokens.userId, payload.userId),
            eq(refreshTokens.tokenHash, await hashToken(presentedToken)),
            isNull(refreshTokens.revokedAt),
        ))
        .returning({id: refreshTokens.id})

    return Boolean(revoked)
}
