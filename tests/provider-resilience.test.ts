import {beforeEach, describe, expect, test} from 'bun:test'
import {
    executeProviderRequest,
    resetProviderCircuitsForTests,
    streamProviderRequest,
} from '../src/llm/resilience/provider-resilience'

beforeEach(() => resetProviderCircuitsForTests())

describe('provider resilience', () => {
    test('retries a transient failure before a result is returned', async () => {
        let attempts = 0
        const result = await executeProviderRequest({
            key: 'test:retry',
            operation: async () => {
                attempts += 1
                if (attempts === 1) {
                    const error = new Error('temporary gateway failure') as Error & {status: number}
                    error.status = 503
                    throw error
                }
                return 'ok'
            },
        })

        expect(result).toBe('ok')
        expect(attempts).toBe(2)
    })

    test('never retries a stream after an event has been emitted', async () => {
        let attempts = 0
        const events: string[] = []

        await expect((async () => {
            for await (const event of streamProviderRequest({
                key: 'test:stream-no-retry',
                operation: async function *() {
                    attempts += 1
                    yield 'partial'
                    const error = new Error('connection reset') as Error & {status: number}
                    error.status = 503
                    throw error
                },
            })) {
                events.push(event)
            }
        })()).rejects.toThrow('connection reset')

        expect(events).toEqual(['partial'])
        expect(attempts).toBe(1)
    })

    test('opens a circuit after repeated terminal failures', async () => {
        const key = 'test:circuit'
        let executions = 0

        for (let index = 0; index < 5; index++) {
            await expect(executeProviderRequest({
                key,
                operation: async () => {
                    executions += 1
                    throw new Error('invalid non-transient request')
                },
            })).rejects.toThrow('invalid non-transient request')
        }

        await expect(executeProviderRequest({
            key,
            operation: async () => {
                executions += 1
                return 'should-not-run'
            },
        })).rejects.toMatchObject({name: 'ProviderCircuitOpenError'})

        expect(executions).toBe(5)
    })
})
