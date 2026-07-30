import {describe, expect, test} from 'bun:test'
import {KeyedConcurrencyLimiter} from '../src/services/chat-concurrency-service'
import {FixedWindowRateLimiter} from '../src/services/rate-limit-service'

describe('FixedWindowRateLimiter', () => {
    test('enforces a fixed window and resets after expiration', () => {
        let now = 1_000
        const limiter = new FixedWindowRateLimiter({
            limit: 2,
            windowMs: 1_000,
            maxKeys: 100,
            now: () => now,
        })

        expect(limiter.consume('user-1')).toMatchObject({allowed: true, remaining: 1})
        expect(limiter.consume('user-1')).toMatchObject({allowed: true, remaining: 0})
        expect(limiter.consume('user-1')).toMatchObject({allowed: false, remaining: 0})

        now = 2_001
        expect(limiter.consume('user-1')).toMatchObject({allowed: true, remaining: 1})
    })

    test('keeps the key map bounded', () => {
        const limiter = new FixedWindowRateLimiter({
            limit: 1,
            windowMs: 60_000,
            maxKeys: 2,
            now: () => 1_000,
        })

        limiter.consume('a')
        limiter.consume('b')
        limiter.consume('c')

        expect(limiter.size).toBe(2)
        expect(limiter.consume('a').allowed).toBe(true)
    })
})

describe('KeyedConcurrencyLimiter', () => {
    test('acquires all keys atomically and releases idempotently', () => {
        const limiter = new KeyedConcurrencyLimiter()
        const first = limiter.tryAcquire([
            {key: 'user:1', limit: 2},
            {key: 'session:1', limit: 1},
        ])

        expect(first).not.toBeNull()
        expect(limiter.count('user:1')).toBe(1)
        expect(limiter.count('session:1')).toBe(1)
        expect(limiter.tryAcquire([
            {key: 'user:1', limit: 2},
            {key: 'session:1', limit: 1},
        ])).toBeNull()
        expect(limiter.count('user:1')).toBe(1)

        first?.release()
        first?.release()
        expect(limiter.count('user:1')).toBe(0)
        expect(limiter.count('session:1')).toBe(0)
    })
})
