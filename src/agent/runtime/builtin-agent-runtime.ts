import {getBuiltinAgentDefinition, listOwnedToolNames} from '../../agents/catalog.js'
import type {BuiltinAgentKey} from '../../intent/domain/intent.js'
import type {ModelProfile} from '../types/agent.js'
import {
    defaultAgentRuntimeFactory,
    type AgentRuntimeDescriptor,
    type AgentRuntimeFactory,
} from './agent-runtime-factory.js'

export interface BuiltinAgentRuntimeOptions {
    modelProfile?: ModelProfile
    maxSteps?: number
    factory?: AgentRuntimeFactory
}

export function createBuiltinAgentRuntime(
    agentKey: BuiltinAgentKey,
    options: BuiltinAgentRuntimeOptions = {},
): AgentRuntimeDescriptor {
    const definition = getBuiltinAgentDefinition(agentKey)
    const factory = options.factory ?? defaultAgentRuntimeFactory

    return factory.create({
        name: definition.name,
        description: definition.description,
        systemPrompt: definition.systemPrompt,
        modelProfile: options.modelProfile ?? 'general',
        maxSteps: options.maxSteps ?? 5,
        tools: listOwnedToolNames(agentKey),
    })
}
