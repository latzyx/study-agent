import {describe, expect, test} from 'bun:test'
import {
    findUnknownBuiltinTools,
    listBuiltinToolNames,
    resolveBuiltinTools,
} from '../src/tools/builtin/index.js'

describe('builtin tool catalog', () => {
    test('lists registered tools without duplicates', () => {
        const names = listBuiltinToolNames()

        expect(names).toContain('calculator')
        expect(names).toContain('current_time')
        expect(new Set(names).size).toBe(names.length)
    })

    test('reports unknown tools and normalizes duplicates', () => {
        expect(findUnknownBuiltinTools(['calculator', 'missing', 'missing']))
            .toEqual(['missing'])

        expect(resolveBuiltinTools(['calculator', 'calculator']).map((tool) => tool.name))
            .toEqual(['calculator'])
    })
})
