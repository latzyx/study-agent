import type {Tool} from '../domain/tool.js'
import {
    getToolOwner,
    listBuiltinTools,
    resolveBuiltinTool,
} from '../../agents/catalog.js'
import {calculatorSchema, calculatorTool} from '../../agents/math/index.js'
import {currentTimeSchema, currentTimeTool} from '../../agents/time/index.js'

export {
    calculatorSchema,
    calculatorTool,
    currentTimeSchema,
    currentTimeTool,
    getToolOwner,
}

export const builtinTools: readonly Tool[] = listBuiltinTools()

export function listBuiltinToolNames(): string[] {
    return builtinTools.map((tool) => tool.name)
}

export function findUnknownBuiltinTools(names: readonly string[]): string[] {
    return [...new Set(names)].filter((name) => !resolveBuiltinTool(name))
}

export function resolveBuiltinTools(names: readonly string[]): Tool[] {
    const uniqueNames = [...new Set(names)]
    const unknown = findUnknownBuiltinTools(uniqueNames)
    if (unknown.length > 0) {
        throw new Error(`Unknown builtin tools: ${unknown.join(', ')}`)
    }

    return uniqueNames.map((name) => {
        const tool = resolveBuiltinTool(name)
        if (!tool) throw new Error(`Builtin tool disappeared during resolution: ${name}`)
        return tool
    })
}
