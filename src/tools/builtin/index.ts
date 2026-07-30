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
    return [...new Set(names)]
        .map((name) => resolveBuiltinTool(name))
        .filter((tool): tool is Tool => Boolean(tool))
}
