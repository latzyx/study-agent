import {createApiError} from '../api/errors/api-error.js'
import {env} from '../config/env.js'

export interface ConcurrencyKey {
    key: string
    limit: number
}

export interface ConcurrencyLease {
    release(): void | Promise<void>
}

export interface ChatConcurrencyBackend {
    tryAcquire(keys: readonly ConcurrencyKey[]): Promise<ConcurrencyLease | null>
}

function normalizeKeys(keys: readonly ConcurrencyKey[]): Map<string, number> {
    const normalized = new Map<string, number>()
    for (const item of keys) {
        if (!item.key.trim()) throw new Error('Concurrency key cannot be empty')
        if (!Number.isSafeInteger(item.limit) || item.limit <= 0) {
            throw new Error(`Concurrency limit must be a positive integer: ${item.key}`)
        }

        const currentLimit = normalized.get(item.key)
        normalized.set(item.key, currentLimit === undefined
            ? item.limit
            : Math.min(currentLimit, item.limit))
    }
    return normalized
}

export class InMemoryChatConcurrencyBackend implements ChatConcurrencyBackend {
    private readonly active = new Map<string, number>()

    async tryAcquire(keys: readonly ConcurrencyKey[]): Promise<ConcurrencyLease | null> {
        const normalized = normalizeKeys(keys)

        for (const [key, limit] of normalized) {
            if ((this.active.get(key) ?? 0) >= limit) return null
        }

        for (const key of normalized.keys()) {
            this.active.set(key, (this.active.get(key) ?? 0) + 1)
        }

        let released = false
        return {
            release: () => {
                if (released) return
                released = true

                for (const key of normalized.keys()) {
                    const next = (this.active.get(key) ?? 1) - 1
                    if (next <= 0) this.active.delete(key)
                    else this.active.set(key, next)
                }
            },
        }
    }

    count(key: string): number {
        return this.active.get(key) ?? 0
    }

    clear(): void {
        this.active.clear()
    }
}

let chatConcurrencyBackend: ChatConcurrencyBackend = new InMemoryChatConcurrencyBackend()

export function configureChatConcurrencyBackend(backend: ChatConcurrencyBackend): void {
    chatConcurrencyBackend = backend
}

export function resetChatConcurrencyBackend(): void {
    chatConcurrencyBackend = new InMemoryChatConcurrencyBackend()
}

export async function acquireChatExecutionLease(
    userId: string,
    sessionId: string,
): Promise<ConcurrencyLease> {
    const normalizedUserId = userId.trim()
    const normalizedSessionId = sessionId.trim()
    if (!normalizedUserId || !normalizedSessionId) {
        throw createApiError(500, 'INVALID_CHAT_CONCURRENCY_KEY', 'Chat concurrency key is invalid')
    }

    const lease = await chatConcurrencyBackend.tryAcquire([
        {
            key: `chat:user:${normalizedUserId}`,
            limit: env.limits.chat.maxConcurrentPerUser,
        },
        {
            key: `chat:session:${normalizedUserId}:${normalizedSessionId}`,
            limit: env.limits.chat.maxConcurrentPerSession,
        },
    ])

    if (!lease) {
        throw createApiError(
            429,
            'CHAT_CONCURRENCY_LIMITED',
            'Too many concurrent chat requests.',
            {
                maxConcurrentPerUser: env.limits.chat.maxConcurrentPerUser,
                maxConcurrentPerSession: env.limits.chat.maxConcurrentPerSession,
            },
            {'retry-after': '1'},
        )
    }

    return lease
}
