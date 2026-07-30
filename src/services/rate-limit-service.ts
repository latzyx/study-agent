import {createApiError} from '../api/errors/api-error.js'

export interface RateLimitPolicy {
    limit: number
    windowMs: number
}

export interface RateLimitDecision {
    allowed: boolean
    limit: number
    remaining: number
    resetAt: number
}

interface RateLimitEntry {
    count: number
    resetAt: number
}

export interface FixedWindowRateLimiterOptions extends RateLimitPolicy {
    maxKeys: number
    now?: () => number
}

export class FixedWindowRateLimiter {
    private readonly entries = new Map<string, RateLimitEntry>()
    private readonly now: () => number

    constructor(private readonly options: FixedWindowRateLimiterOptions) {
        this.now = options.now ?? Date.now
    }

    consume(key: string): RateLimitDecision {
        const now = this.now()
        let entry = this.entries.get(key)

        if (!entry || entry.resetAt <= now) {
            this.ensureCapacity(now)
            entry = {count: 0, resetAt: now + this.options.windowMs}
            this.entries.set(key, entry)
        }

        if (entry.count >= this.options.limit) {
            return {
                allowed: false,
                limit: this.options.limit,
                remaining: 0,
                resetAt: entry.resetAt,
            }
        }

        entry.count += 1
        return {
            allowed: true,
            limit: this.options.limit,
            remaining: Math.max(0, this.options.limit - entry.count),
            resetAt: entry.resetAt,
        }
    }

    reset(key: string): void {
        this.entries.delete(key)
    }

    clear(): void {
        this.entries.clear()
    }

    get size(): number {
        return this.entries.size
    }

    private ensureCapacity(now: number): void {
        if (this.entries.size < this.options.maxKeys) return

        for (const [key, entry] of this.entries) {
            if (entry.resetAt <= now) this.entries.delete(key)
        }

        while (this.entries.size >= this.options.maxKeys) {
            const oldestKey = this.entries.keys().next().value as string | undefined
            if (!oldestKey) break
            this.entries.delete(oldestKey)
        }
    }
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
    const retryAfterSeconds = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000))

    return {
        'retry-after': String(retryAfterSeconds),
        'x-ratelimit-limit': String(decision.limit),
        'x-ratelimit-remaining': String(decision.remaining),
        'x-ratelimit-reset': String(Math.ceil(decision.resetAt / 1000)),
    }
}

export function enforceRateLimit(
    decision: RateLimitDecision,
    code: string,
    message: string,
): void {
    if (decision.allowed) return

    throw createApiError(
        429,
        code,
        message,
        {
            limit: decision.limit,
            resetAt: new Date(decision.resetAt).toISOString(),
        },
        rateLimitHeaders(decision),
    )
}
