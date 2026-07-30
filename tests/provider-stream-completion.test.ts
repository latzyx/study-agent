import {describe, expect, test} from 'bun:test'
import {BaseAgent} from '../src/agent/base-agent'
import type {AgentEvent} from '../src/agent/types/agent'
import type {LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent} from '../src/llm/domain/llm-provider'
import {ToolRegistry} from '../src/tools/registry/tool-registry'

class IncompleteProvider implements LLMProvider {
    async generate(_request: LLMRequest): Promise<LLMResponse> {
        throw new Error('unused')
    }

    async *stream(_request: LLMRequest): AsyncIterable<LLMStreamEvent> {
        yield {type: 'text-delta', text: 'partial'}
    }
}

describe('provider stream completion', () => {
    test('does not convert a truncated provider stream into a successful finish', async () => {
        const agent = new (class extends BaseAgent {})(
            {
                name: 'test',
                description: '',
                systemPrompt: 'test',
                modelProfile: 'general',
                modelId: 'test:model',
            },
            new IncompleteProvider(),
            new ToolRegistry(),
        )
        const events: AgentEvent[] = []

        for await (const event of agent.run('hello')) events.push(event)

        expect(events.map((event) => event.type)).toEqual(['text-delta', 'error'])
        expect(events.at(-1)?.error?.message).toContain('stream ended without finish')
    })
})
