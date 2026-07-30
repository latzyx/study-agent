import type {Tool} from '../domain/tool.js'
import {calculatorSchema, calculatorTool} from './calculator.tool.js'
import {currentTimeSchema, currentTimeTool} from './current-time.tool.js'

export {
    calculatorSchema,
    calculatorTool,
    currentTimeSchema,
    currentTimeTool,
}

export const builtinTools = [
    calculatorTool,
    currentTimeTool,
] satisfies readonly Tool<any, any>[]

const builtinToolMap = new Map<string, Tool<any, any>>(
    builtinTools.map((tool) => [tool.name, tool]),
)

export function listBuiltinToolNames(): string[] {
    return [...builtinToolMap.keys()]
}

export function findUnknownBuiltinTools(names: readonly string[]): string[] {
    return [...new Set(names)].filter((name) => !builtinToolMap.has(name))
}

export function resolveBuiltinTools(names: readonly string[]): Tool<any, any>[] {
    return [...new Set(names)]
        .map((name) => builtinToolMap.get(name))
        .filter((tool): tool is Tool<any, any> => Boolean(tool))
}
