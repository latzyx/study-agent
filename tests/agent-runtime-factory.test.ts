import {describe, expect, test} from 'bun:test'
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

function factory() {
    return new AgentRuntimeFactory({
        resolveModelId: (profile) => `test:${profile}`,
        createProvider: () => new NoopProvider(),
        createToolRegistry: () => new ToolRegistry(),
    })
}

describe('AgentRuntimeFactory', () => {
    test('creates an immutable runtime descriptor from one config snapshot', () => {
        const runtime = factory().create({
            name: ' Math ',
            description: ' test ',
            systemPrompt: ' calculate ',
            modelProfile: 'general',
            maxSteps: 4,
            tools: [' calculator ', 'calculator'],
        })

        expect(runtime.agentKey).toBe('math')
        expect(runtime.modelId).toBe('test:general')
        expect(runtime.toolNames).toEqual(['calculator'])
        expect(runtime.agent.config).toMatchObject({
            name: 'Math',
            description: 'test',
            systemPrompt: 'calculate',
            maxSteps: 4,
            modelId: 'test:general',
        })
    })

    test('rejects invalid runtime snapshots before provider execution', () => {
        expect(() => factory().create({
            name: '   ',
            modelProfile: 'general',
            maxSteps: 4,
            tools: [],
        })).toThrow('Agent runtime name cannot be empty')

        expect(() => factory().create({
            name: 'test',
            modelProfile: 'general',
            maxSteps: 0,
            tools: [],
        })).toThrow('Agent runtime maxSteps must be a positive integer')
    })

    test('rejects mixed tool ownership at the runtime boundary', () => {
        expect(() => factory().create({
            name: 'mixed',
            modelProfile: 'general',
            maxSteps: 4,
            tools: ['calculator', 'current_time'],
        })).toThrow('Tools belong to different agents')
    })
})
