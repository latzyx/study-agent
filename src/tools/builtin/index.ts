import type {Tool} from '../domain/tool.js'
import {calculatorSchema, calculatorTool} from './calculator.tool.js'
import {currentTimeSchema, currentTimeTool} from './current-time.tool.js'

export {
    calculatorSchema,
    calculatorTool,
    currentTimeSchema,
    currentTimeTool,
}

export const builtinTools: readonly Tool[] = [
    calculatorTool,
    currentTimeTool,
]

const builtinToolMap = new Map(builtinTools.map((tool) => [tool.name, tool]))

export function listBuiltinToolNames(): string[] {
    return [...builtinToolMap.keys()]
}

export function findUnknownBuiltinTools(names: readonly string[]): string[] {
    return [...new Set(names)].filter((name) => !builtinToolMap.has(name))
}

export function resolveBuiltinTools(names: readonly string[]): Tool[] {
    return [...new Set(names)]
        .map((name) => builtinToolMap.get(name))
        .filter((tool): tool is Tool => Boolean(tool))
}
