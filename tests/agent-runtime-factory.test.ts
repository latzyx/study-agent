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

function createMathRuntime() {
    return factory().create({
        name: ' Math ',
        description: ' test ',
        systemPrompt: ' calculate ',
        modelProfile: 'general',
        maxSteps: 4,
        tools: [' calculator ', 'calculator'],
    })
}

describe('AgentRuntimeFactory', () => {
    test('creates an immutable runtime descriptor from one config snapshot', () => {
        const runtime = createMathRuntime()

        expect(runtime.agentKey).toBe('math')
        expect(runtime.modelId).toBe('test:general')
        expect(runtime.toolNames).toEqual(['calculator'])
        expect(runtime.snapshot).toEqual({
            name: 'Math',
            description: 'test',
            systemPrompt: 'calculate',
            modelProfile: 'general',
            modelId: 'test:general',
            maxSteps: 4,
            agentKey: 'math',
            toolNames: ['calculator'],
        })
        expect(runtime.agent.config).toMatchObject({
            name: 'Math',
            description: 'test',
            systemPrompt: 'calculate',
            maxSteps: 4,
            modelId: 'test:general',
        })
        expect(Object.isFrozen(runtime)).toBe(true)
        expect(Object.isFrozen(runtime.snapshot)).toBe(true)
        expect(Object.isFrozen(runtime.toolNames)).toBe(true)
        expect(Object.isFrozen(runtime.agent.config)).toBe(true)
        expect(Object.isFrozen(runtime.agent.config.tools)).toBe(true)
    })

    test('creates a deterministic fingerprint for equivalent normalized snapshots', () => {
        const first = createMathRuntime()
        const second = factory().create({
            name: 'Math',
            description: 'test',
            systemPrompt: 'calculate',
            modelProfile: 'general',
            maxSteps: 4,
            tools: ['calculator'],
        })
        const changed = factory().create({
            name: 'Math',
            description: 'test',
            systemPrompt: 'calculate carefully',
            modelProfile: 'general',
            maxSteps: 4,
            tools: ['calculator'],
        })

        expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/)
        expect(second.fingerprint).toBe(first.fingerprint)
        expect(changed.fingerprint).not.toBe(first.fingerprint)
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
