import type {
    LLMProvider,
    LLMRequest,
    LLMResponse,
    LLMStreamEvent,
} from '../domain/llm-provider.js'
import {isTransientProviderError} from '../resilience/provider-resilience.js'

function shouldFallback(error: unknown): boolean {
    return isTransientProviderError(error)
        || (error instanceof Error && error.name === 'ProviderCircuitOpenError')
}

export class FallbackLLMProvider implements LLMProvider {
    constructor(
        private readonly primary: LLMProvider,
        private readonly fallback?: LLMProvider,
    ) {}

    async generate(request: LLMRequest): Promise<LLMResponse> {
        try {
            return await this.primary.generate(request)
        } catch (error) {
            if (!this.fallback || !shouldFallback(error) || request.abortSignal?.aborted) throw error
            return this.fallback.generate(request)
        }
    }

    async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
        let emitted = false

        try {
            for await (const event of this.primary.stream(request)) {
                if (event.type === 'error') {
                    if (!emitted && this.fallback && shouldFallback(event.error) && !request.abortSignal?.aborted) {
                        yield* this.fallback.stream(request)
                        return
                    }
                    yield event
                    return
                }

                emitted = true
                yield event
            }
        } catch (error) {
            if (!emitted && this.fallback && shouldFallback(error) && !request.abortSignal?.aborted) {
                yield* this.fallback.stream(request)
                return
            }
            yield {
                type: 'error',
                error: error instanceof Error ? error : new Error(String(error)),
            }
        }
    }
}
