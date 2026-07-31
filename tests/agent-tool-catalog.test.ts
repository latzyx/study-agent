import {describe, expect, test} from 'bun:test'
import {
    getToolOwner,
    inferAgentKeyFromTools,
    listOwnedToolNames,
    resolveAgentTools,
} from '../src/agents/catalog'

describe('builtin agent tool catalog', () => {
    test('assigns each tool to exactly one agent', () => {
        expect(getToolOwner('calculator')).toBe('math')
        expect(getToolOwner('current_time')).toBe('time')
        expect(listOwnedToolNames('general')).toEqual([])
    })

    test('infers the runtime agent from its authoritative tool set', () => {
        expect(inferAgentKeyFromTools([])).toBe('general')
        expect(inferAgentKeyFromTools(['calculator', 'calculator'])).toBe('math')
        expect(inferAgentKeyFromTools(['current_time'])).toBe('time')
    })

    test('rejects mixed tool ownership', () => {
        expect(() => inferAgentKeyFromTools(['calculator', 'current_time']))
            .toThrow('Tools belong to different agents: math, time')
    })

    test('resolves only tools owned by the selected agent', () => {
        expect(resolveAgentTools('math').map((tool) => tool.name)).toEqual(['calculator'])
        expect(resolveAgentTools('time', ['current_time']).map((tool) => tool.name))
            .toEqual(['current_time'])
    })

    test('rejects cross-agent tool assignment', () => {
        expect(() => resolveAgentTools('math', ['current_time']))
            .toThrow('Tools are not owned by agent math: current_time')
    })
})