import {describe, expect, test} from 'bun:test'
import {
    InMemoryChatConcurrencyBackend,
    type ChatConcurrencyBackend,
    type ConcurrencyKey,
} from '../src/services/chat-concurrency-service'

describe('chat concurrency backend', () => {
    test('acquires multiple keys atomically and releases them idempotently', async () => {
        const backend = new InMemoryChatConcurrencyBackend()
        const keys: ConcurrencyKey[] = [
            {key: 'chat:user:user-1', limit: 2},
            {key: 'chat:session:user-1:session-1', limit: 1},
        ]

        const first = await backend.tryAcquire(keys)
        expect(first).not.toBeNull()
        expect(backend.count('chat:user:user-1')).toBe(1)
        expect(backend.count('chat:session:user-1:session-1')).toBe(1)

        const rejected = await backend.tryAcquire(keys)
        expect(rejected).toBeNull()
        expect(backend.count('chat:user:user-1')).toBe(1)

        await first?.release()
        await first?.release()
        expect(backend.count('chat:user:user-1')).toBe(0)
        expect(backend.count('chat:session:user-1:session-1')).toBe(0)
    })

    test('uses the strictest limit when the same key appears more than once in one request', async () => {
        const backend = new InMemoryChatConcurrencyBackend()
        const duplicateKeys = [
            {key: 'shared', limit: 3},
            {key: 'shared', limit: 1},
        ]
        const first = await backend.tryAcquire(duplicateKeys)

        expect(first).not.toBeNull()
        expect(backend.count('shared')).toBe(1)
        await expect(backend.tryAcquire(duplicateKeys)).resolves.toBeNull()
        await first?.release()
    })

    test('rejects invalid keys and limits before mutating counters', async () => {
        const backend = new InMemoryChatConcurrencyBackend()

        await expect(backend.tryAcquire([{key: ' ', limit: 1}]))
            .rejects.toThrow('Concurrency key cannot be empty')
        await expect(backend.tryAcquire([{key: 'valid', limit: 0}]))
            .rejects.toThrow('Concurrency limit must be a positive integer')
        expect(backend.count('valid')).toBe(0)
    })

    test('defines an async backend contract suitable for Redis or database leases', async () => {
        const calls: ConcurrencyKey[][] = []
        const backend: ChatConcurrencyBackend = {
            async tryAcquire(keys) {
                calls.push([...keys])
                return {async release() {}}
            },
        }

        const lease = await backend.tryAcquire([{key: 'distributed', limit: 1}])
        await lease?.release()
        expect(calls).toEqual([[{key: 'distributed', limit: 1}]])
    })
})
