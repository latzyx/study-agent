import type {BuiltinAgentKey} from '../intent/domain/intent.js'
import type {Tool} from '../tools/domain/tool.js'
import type {BuiltinAgentDefinition} from './domain/agent-definition.js'
import {generalAgentDefinition} from './general/index.js'
import {mathAgentDefinition} from './math/index.js'
import {timeAgentDefinition} from './time/index.js'

const definitions = [
    generalAgentDefinition,
    mathAgentDefinition,
    timeAgentDefinition,
] satisfies readonly BuiltinAgentDefinition[]

const definitionMap = new Map<BuiltinAgentKey, BuiltinAgentDefinition>()
const toolMap = new Map<string, Tool>()
const toolOwnerMap = new Map<string, BuiltinAgentKey>()

for (const definition of definitions) {
    if (definitionMap.has(definition.key)) {
        throw new Error(`Builtin agent declared more than once: ${definition.key}`)
    }
    definitionMap.set(definition.key, definition)

    for (const tool of definition.tools) {
        const existingOwner = toolOwnerMap.get(tool.name)
        if (existingOwner) {
            throw new Error(`Tool ${tool.name} is owned by multiple agents: ${existingOwner}, ${definition.key}`)
        }
        toolMap.set(tool.name, tool)
        toolOwnerMap.set(tool.name, definition.key)
    }
}

export function listBuiltinAgentDefinitions(): readonly BuiltinAgentDefinition[] {
    return definitions
}

export function getBuiltinAgentDefinition(agentKey: BuiltinAgentKey): BuiltinAgentDefinition {
    const definition = definitionMap.get(agentKey)
    if (!definition) throw new Error(`Unknown builtin agent: ${agentKey}`)
    return definition
}

export function listOwnedToolNames(agentKey: BuiltinAgentKey): string[] {
    return getBuiltinAgentDefinition(agentKey).tools.map((tool) => tool.name)
}

export function getToolOwner(toolName: string): BuiltinAgentKey | undefined {
    return toolOwnerMap.get(toolName)
}

export function inferAgentKeyFromTools(toolNames: readonly string[]): BuiltinAgentKey {
    const normalizedNames = [...new Set(toolNames)]
    if (normalizedNames.length === 0) return 'general'

    const unknown = normalizedNames.filter((name) => !toolOwnerMap.has(name))
    if (unknown.length > 0) {
        throw new Error(`Unknown builtin tools: ${unknown.join(', ')}`)
    }

    const owners = [...new Set(normalizedNames.map((name) => toolOwnerMap.get(name)!))]
    if (owners.length !== 1) {
        throw new Error(`Tools belong to different agents: ${owners.join(', ')}`)
    }

    return owners[0]!
}

export function listBuiltinTools(): Tool[] {
    return [...toolMap.values()]
}

export function resolveBuiltinTool(toolName: string): Tool | undefined {
    return toolMap.get(toolName)
}

export function resolveAgentTools(agentKey: BuiltinAgentKey, requestedNames?: readonly string[]): Tool[] {
    const definition = getBuiltinAgentDefinition(agentKey)
    const allowed = new Map(definition.tools.map((tool) => [tool.name, tool]))
    const names = [...new Set(requestedNames ?? [...allowed.keys()])]
    const unknownOrUnowned = names.filter((name) => !allowed.has(name))

    if (unknownOrUnowned.length > 0) {
        throw new Error(
            `Tools are not owned by agent ${agentKey}: ${unknownOrUnowned.join(', ')}`,
        )
    }

    return names.map((name) => {
        const tool = allowed.get(name)
        if (!tool) throw new Error(`Tool ownership changed during resolution: ${name}`)
        return tool
    })
}