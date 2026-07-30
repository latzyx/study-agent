import {and, eq, lt} from 'drizzle-orm'
import {createApiError} from '../api/errors/api-error.js'
import {db} from '../db/index.js'
import {chatRequests, conversations} from '../db/schema.js'

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/

export interface IdempotentChatResult {
    reply: string
    sessionId: string
    traceId?: string
    toolCalls: Array<{
        name: string
        args: unknown
        result: unknown
    }>
    replayed?: boolean
}

export interface BeginChatRequestInput {
    userId: string
    idempotencyKey?: string
    agentId: string
    sessionId?: string
    message: string
}

export type BeginChatRequestResult =
    | {kind: 'disabled'}
    | {kind: 'execute'; requestRecordId: string}
    | {kind: 'replay'; result: IdempotentChatResult}

async function sha256(value: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(value),
    ))
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalizeKey(value?: string): string | undefined {
    const key = value?.trim()
    if (!key) return undefined
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
        throw createApiError(
            400,
            'INVALID_IDEMPOTENCY_KEY',
            'Idempotency-Key must contain 1-100 letters, numbers, dot, underscore, colon or hyphen',
        )
    }
    return key
}

async function requestHash(input: BeginChatRequestInput): Promise<string> {
    return sha256(JSON.stringify({
        agentId: input.agentId,
        sessionId: input.sessionId?.trim() || null,
        message: input.message,
    }))
}

function parseCachedResult(value: unknown): IdempotentChatResult {
    if (!value || typeof value !== 'object') {
        throw createApiError(500, 'INVALID_IDEMPOTENT_RESULT', 'Stored idempotent result is invalid')
    }
    const result = value as Record<string, unknown>
    if (
        typeof result.reply !== 'string'
        || typeof result.sessionId !== 'string'
        || !Array.isArray(result.toolCalls)
    ) {
        throw createApiError(500, 'INVALID_IDEMPOTENT_RESULT', 'Stored idempotent result is invalid')
    }

    return {
        reply: result.reply,
        sessionId: result.sessionId,
        traceId: typeof result.traceId === 'string' ? result.traceId : undefined,
        toolCalls: result.toolCalls as IdempotentChatResult['toolCalls'],
        replayed: true,
    }
}

export async function beginChatRequest(
    input: BeginChatRequestInput,
): Promise<BeginChatRequestResult> {
    const idempotencyKey = normalizeKey(input.idempotencyKey)
    if (!idempotencyKey) return {kind: 'disabled'}

    const hash = await requestHash(input)
    const [created] = await db.insert(chatRequests).values({
        userId: input.userId,
        idempotencyKey,
        requestHash: hash,
        sessionId: input.sessionId?.trim() || null,
        status: 'running',
    }).onConflictDoNothing({
        target: [chatRequests.userId, chatRequests.idempotencyKey],
    }).returning({id: chatRequests.id})

    if (created) return {kind: 'execute', requestRecordId: created.id}

    const [existing] = await db.select().from(chatRequests).where(and(
        eq(chatRequests.userId, input.userId),
        eq(chatRequests.idempotencyKey, idempotencyKey),
    )).limit(1)
    if (!existing) {
        throw createApiError(500, 'IDEMPOTENCY_STATE_LOST', 'Failed to resolve idempotent request')
    }
    if (existing.requestHash !== hash) {
        throw createApiError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'The same Idempotency-Key was already used with different request parameters',
        )
    }
    if (existing.status === 'success' && existing.result) {
        return {kind: 'replay', result: parseCachedResult(existing.result)}
    }
    if (existing.status === 'running') {
        throw createApiError(
            409,
            'IDEMPOTENT_REQUEST_IN_PROGRESS',
            'A request with this Idempotency-Key is still running',
            {traceId: existing.traceId ?? undefined},
            {'Retry-After': '1'},
        )
    }

    throw createApiError(
        409,
        'IDEMPOTENT_REQUEST_TERMINAL',
        'A previous request with this Idempotency-Key did not complete successfully; use a new key to retry',
        {
            status: existing.status,
            traceId: existing.traceId ?? undefined,
            errorCode: existing.errorCode ?? undefined,
        },
    )
}

export async function attachChatRequestExecution(input: {
    requestRecordId?: string
    conversationId: string
    sessionId: string
    traceId?: string
}): Promise<void> {
    if (!input.requestRecordId) return

    const [conversation] = await db.select({agentId: conversations.agentId})
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1)
    if (!conversation) {
        throw createApiError(404, 'SESSION_NOT_FOUND', 'Conversation no longer exists')
    }

    await db.update(chatRequests).set({
        agentId: conversation.agentId,
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        traceId: input.traceId,
        updatedAt: new Date(),
    }).where(and(
        eq(chatRequests.id, input.requestRecordId),
        eq(chatRequests.status, 'running'),
    ))
}

export async function failChatRequest(input: {
    requestRecordId?: string
    status: 'error' | 'aborted'
    traceId?: string
    errorCode?: string
    error: Error
}): Promise<void> {
    if (!input.requestRecordId) return
    await db.update(chatRequests).set({
        status: input.status,
        traceId: input.traceId,
        errorCode: input.errorCode,
        errorMessage: input.error.message.slice(0, 4000),
        finishedAt: new Date(),
        updatedAt: new Date(),
    }).where(and(
        eq(chatRequests.id, input.requestRecordId),
        eq(chatRequests.status, 'running'),
    ))
}

export async function recoverStaleChatRequests(staleBefore: Date): Promise<number> {
    const recovered = await db.update(chatRequests).set({
        status: 'aborted',
        errorCode: 'STALE_REQUEST_RECOVERED',
        errorMessage: 'The process ended before the idempotent request reached a terminal state',
        finishedAt: new Date(),
        updatedAt: new Date(),
    }).where(and(
        eq(chatRequests.status, 'running'),
        lt(chatRequests.updatedAt, staleBefore),
    )).returning({id: chatRequests.id})

    return recovered.length
}
