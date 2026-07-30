import {describe, expect, test} from 'bun:test'
import {z} from 'zod'
import type {Tool} from '../src/tools/domain/tool'
import {ToolRegistry} from '../src/tools/registry/tool-registry'

function createTool(name: string, value: string): Tool<Record<string, never>, string> {
    return {
        name,
        description: `${name} test tool`,
        inputSchema: z.object({}),
        async execute() {
            return value
        },
    }
}

describe('ToolRegistry scopes', () => {
    test('allows independent implementations with the same name', async () => {
        const registry = new ToolRegistry()
        const scopeA = Symbol('agent-a')
        const scopeB = Symbol('agent-b')

        registry.register(createTool('lookup', 'A'), scopeA)
        registry.register(createTool('lookup', 'B'), scopeB)

        await expect(registry.execute({id: 'a', name: 'lookup', input: {}}, {}, scopeA))
            .resolves.toBe('A')
        await expect(registry.execute({id: 'b', name: 'lookup', input: {}}, {}, scopeB))
            .resolves.toBe('B')
    })

    test('does not fall back to global tools from an agent scope', async () => {
        const registry = new ToolRegistry()
        const scope = Symbol('agent')

        registry.register(createTool('lookup', 'global'))

        await expect(registry.execute({id: 'scoped', name: 'lookup', input: {}}, {}, scope))
            .rejects.toThrow('Unknown tool: lookup')
    })

    test('clears only the selected scope', () => {
        const registry = new ToolRegistry()
        const scopeA = Symbol('agent-a')
        const scopeB = Symbol('agent-b')

        registry.register(createTool('lookup', 'A'), scopeA)
        registry.register(createTool('lookup', 'B'), scopeB)
        registry.clear(scopeA)

        expect(registry.list(scopeA)).toEqual([])
        expect(registry.list(scopeB).map((tool) => tool.name)).toEqual(['lookup'])
    })
})