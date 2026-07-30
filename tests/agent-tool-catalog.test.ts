import {describe, expect, test} from 'bun:test'
import {
    getToolOwner,
    listOwnedToolNames,
    resolveAgentTools,
} from '../src/agents/catalog'

describe('builtin agent tool catalog', () => {
    test('assigns each tool to exactly one agent', () => {
        expect(getToolOwner('calculator')).toBe('math')
        expect(getToolOwner('current_time')).toBe('time')
        expect(listOwnedToolNames('general')).toEqual([])
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
