import {describe, expect, test} from 'bun:test'
import {createBuiltinAgentRuntime} from '../src/agent/runtime/builtin-agent-runtime'
import {AgentRuntimeFactory} from '../src/agent/runtime/agent-runtime-factory'
import type {LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent} from '../src/llm/domain/llm-provider'
import {ToolRegistry} from '../src/tools/registry/tool-registry'

class NoopProvider implements LLMProvider {
    async generate(_request: LLMRequest): Promise<LLMResponse> {
        return {text: '', toolCalls: []}
    }

    async *stream(_request: LLMRequest): AsyncIterable<LLMStreamEvent> {
        yield {type: 'finish', response: {text: 'ok', toolCalls: []}}
    }
}

const factory = new AgentRuntimeFactory({
    resolveModelId: (profile) => `test:${profile}`,
    createProvider: () => new NoopProvider(),
    createToolRegistry: () => new ToolRegistry(),
})

describe('builtin agent runtime', () => {
    test('creates specialized runtimes with only owned tools', () => {
        expect(createBuiltinAgentRuntime('general', {factory}).toolNames).toEqual([])
        expect(createBuiltinAgentRuntime('math', {factory}).toolNames).toEqual(['calculator'])
        expect(createBuiltinAgentRuntime('time', {factory}).toolNames).toEqual(['current_time'])
    })

    test('uses the catalog prompt and selected model profile', () => {
        const runtime = createBuiltinAgentRuntime('math', {
            factory,
            modelProfile: 'reasoning',
            maxSteps: 7,
        })

        expect(runtime.agentKey).toBe('math')
        expect(runtime.modelId).toBe('test:reasoning')
        expect(runtime.agent.config.maxSteps).toBe(7)
        expect(runtime.agent.config.systemPrompt).toContain('calculator')
    })
})
