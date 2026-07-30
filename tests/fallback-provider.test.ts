import {describe, expect, test} from 'bun:test'
import type {
    LLMProvider,
    LLMRequest,
    LLMResponse,
    LLMStreamEvent,
} from '../src/llm/domain/llm-provider'
import {FallbackLLMProvider} from '../src/llm/providers/fallback-provider'

function response(text: string): LLMResponse {
    return {text, toolCalls: [], finishReason: 'stop'}
}

class FakeProvider implements LLMProvider {
    generateCalls = 0
    streamCalls = 0

    constructor(
        private readonly generateImpl: () => Promise<LLMResponse>,
        private readonly streamImpl: () => AsyncIterable<LLMStreamEvent>,
    ) {}

    async generate(_request: LLMRequest): Promise<LLMResponse> {
        this.generateCalls += 1
        return this.generateImpl()
    }

    stream(_request: LLMRequest): AsyncIterable<LLMStreamEvent> {
        this.streamCalls += 1
        return this.streamImpl()
    }
}

const request: LLMRequest = {model: 'test:model', messages: []}

describe('FallbackLLMProvider', () => {
    test('falls back for a transient generate failure', async () => {
        const primary = new FakeProvider(
            async () => {
                const error = new Error('provider unavailable') as Error & {status: number}
                error.status = 503
                throw error
            },
            async function *() {},
        )
        const fallback = new FakeProvider(async () => response('fallback'), async function *() {})
        const provider = new FallbackLLMProvider(primary, fallback)

        await expect(provider.generate(request)).resolves.toMatchObject({text: 'fallback'})
        expect(primary.generateCalls).toBe(1)
        expect(fallback.generateCalls).toBe(1)
    })

    test('falls back when a stream fails before emitting output', async () => {
        const primary = new FakeProvider(async () => response('unused'), async function *() {
            const error = new Error('gateway unavailable') as Error & {status: number}
            error.status = 503
            yield {type: 'error', error}
        })
        const fallback = new FakeProvider(async () => response('unused'), async function *() {
            yield {type: 'text-delta', text: 'fallback'}
            yield {type: 'finish', response: response('fallback')}
        })
        const provider = new FallbackLLMProvider(primary, fallback)
        const events: LLMStreamEvent[] = []

        for await (const event of provider.stream(request)) events.push(event)

        expect(events.some((event) => event.type === 'text-delta' && event.text === 'fallback')).toBe(true)
        expect(primary.streamCalls).toBe(1)
        expect(fallback.streamCalls).toBe(1)
    })

    test('does not fall back after a stream has emitted output', async () => {
        const primary = new FakeProvider(async () => response('unused'), async function *() {
            yield {type: 'text-delta', text: 'partial'}
            const error = new Error('connection reset') as Error & {status: number}
            error.status = 503
            yield {type: 'error', error}
        })
        const fallback = new FakeProvider(async () => response('unused'), async function *() {
            yield {type: 'text-delta', text: 'must-not-run'}
        })
        const provider = new FallbackLLMProvider(primary, fallback)
        const events: LLMStreamEvent[] = []

        for await (const event of provider.stream(request)) events.push(event)

        expect(events[0]).toMatchObject({type: 'text-delta', text: 'partial'})
        expect(events.at(-1)?.type).toBe('error')
        expect(fallback.streamCalls).toBe(0)
    })
})
