import {createApiError} from '../api/errors/api-error.js'
import {env} from '../config/env.js'

export interface ConcurrencyKey {
    key: string
    limit: number
}

export interface ConcurrencyLease {
    release(): void
}

export class KeyedConcurrencyLimiter {
    private readonly active = new Map<string, number>()

    tryAcquire(keys: readonly ConcurrencyKey[]): ConcurrencyLease | null {
        const normalized = new Map<string, number>()
        for (const item of keys) {
            const currentLimit = normalized.get(item.key)
            normalized.set(item.key, currentLimit === undefined
                ? item.limit
                : Math.min(currentLimit, item.limit))
        }

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

const chatConcurrencyLimiter = new KeyedConcurrencyLimiter()

export function acquireChatExecutionLease(userId: string, sessionId: string): ConcurrencyLease {
    const lease = chatConcurrencyLimiter.tryAcquire([
        {
            key: `chat:user:${userId}`,
            limit: env.limits.chat.maxConcurrentPerUser,
        },
        {
            key: `chat:session:${userId}:${sessionId}`,
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
