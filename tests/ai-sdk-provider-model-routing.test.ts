import {describe, expect, test} from 'bun:test'
import {
    AISDKProviderAdapter,
    normalizeRequestedModelId,
} from '../src/llm/providers/ai-sdk-provider'
import type {LLMStreamEvent} from '../src/llm/domain/llm-provider'

async function collectErrors(
    provider: AISDKProviderAdapter,
    model: string,
): Promise<LLMStreamEvent[]> {
    const events: LLMStreamEvent[] = []
    for await (const event of provider.stream({
        model,
        messages: [{role: 'user', content: 'test'}],
    })) {
        events.push(event)
    }
    return events
}

describe('AISDKProviderAdapter request model routing', () => {
    test('rejects an empty request model instead of using a default', () => {
        expect(() => normalizeRequestedModelId('   ')).toThrow('LLM request model cannot be empty')
    })

    test('resolves the model id from every request', async () => {
        const requestedModels: string[] = []
        const provider = new AISDKProviderAdapter((modelId) => {
            requestedModels.push(modelId)
            throw new Error(`missing model: ${modelId}`)
        })

        const first = await collectErrors(provider, 'lmstudio:model-a')
        const second = await collectErrors(provider, 'vllm:model-b')

        expect(requestedModels).toEqual(['lmstudio:model-a', 'vllm:model-b'])
        expect(first).toHaveLength(1)
        expect(second).toHaveLength(1)
        expect(first[0]).toMatchObject({
            type: 'error',
            error: {
                code: 'INVALID_REQUEST',
                retryable: false,
                message: 'Unable to resolve requested LLM model: lmstudio:model-a',
            },
        })
        expect(second[0]).toMatchObject({
            type: 'error',
            error: {
                code: 'INVALID_REQUEST',
                retryable: false,
                message: 'Unable to resolve requested LLM model: vllm:model-b',
            },
        })
    })
})
