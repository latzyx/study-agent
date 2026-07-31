import {createHash} from 'node:crypto'
import {BaseAgent} from '../base-agent.js'
import type {AgentConfig, ModelProfile} from '../types/agent.js'
import {
    inferAgentKeyFromTools,
    resolveAgentTools,
} from '../../agents/catalog.js'
import type {BuiltinAgentKey} from '../../intent/domain/intent.js'
import type {LLMProvider} from '../../llm/domain/llm-provider.js'
import {AISDKProviderAdapter} from '../../llm/providers/ai-sdk-provider.js'
import {resolveModel} from '../../llm/registry/model-registry.js'
import {resolveLanguageModel} from '../../llm/registry/provider-registry.js'
import type {Tool} from '../../tools/domain/tool.js'
import {ToolRegistry} from '../../tools/registry/tool-registry.js'

export interface AgentRuntimeConfigSnapshot {
    name: string
    description?: string | null
    systemPrompt?: string | null
    modelProfile: ModelProfile
    maxSteps: number
    tools: readonly string[]
}

export interface ResolvedAgentRuntimeSnapshot {
    name: string
    description: string
    systemPrompt: string
    modelProfile: ModelProfile
    modelId: string
    maxSteps: number
    agentKey: BuiltinAgentKey
    toolNames: readonly string[]
}

export interface AgentRuntimeDescriptor {
    agent: BaseAgent
    agentKey: BuiltinAgentKey
    modelId: string
    toolNames: readonly string[]
    snapshot: Readonly<ResolvedAgentRuntimeSnapshot>
    fingerprint: string
}

export interface AgentRuntimeFactoryDependencies {
    resolveModelId?: (profile: ModelProfile) => string
    resolveTools?: (agentKey: BuiltinAgentKey, names: readonly string[]) => Tool[]
    inferAgentKey?: (names: readonly string[]) => BuiltinAgentKey
    createProvider?: () => LLMProvider
    createToolRegistry?: () => ToolRegistry
}

function normalizeSnapshot(snapshot: AgentRuntimeConfigSnapshot): AgentRuntimeConfigSnapshot {
    const name = snapshot.name.trim()
    if (!name) throw new Error('Agent runtime name cannot be empty')

    if (!Number.isSafeInteger(snapshot.maxSteps) || snapshot.maxSteps <= 0) {
        throw new Error('Agent runtime maxSteps must be a positive integer')
    }

    return {
        ...snapshot,
        name,
        description: snapshot.description?.trim() || null,
        systemPrompt: snapshot.systemPrompt?.trim() || null,
        tools: [...new Set(snapshot.tools.map((toolName) => toolName.trim()).filter(Boolean))],
    }
}

function createFingerprint(snapshot: ResolvedAgentRuntimeSnapshot): string {
    const canonical = JSON.stringify({
        name: snapshot.name,
        description: snapshot.description,
        systemPrompt: snapshot.systemPrompt,
        modelProfile: snapshot.modelProfile,
        modelId: snapshot.modelId,
        maxSteps: snapshot.maxSteps,
        agentKey: snapshot.agentKey,
        toolNames: [...snapshot.toolNames],
    })

    return createHash('sha256').update(canonical).digest('hex')
}

export class AgentRuntimeFactory {
    private readonly resolveModelId: (profile: ModelProfile) => string
    private readonly resolveTools: (agentKey: BuiltinAgentKey, names: readonly string[]) => Tool[]
    private readonly inferAgentKey: (names: readonly string[]) => BuiltinAgentKey
    private readonly createProvider: () => LLMProvider
    private readonly createToolRegistry: () => ToolRegistry

    constructor(dependencies: AgentRuntimeFactoryDependencies = {}) {
        this.resolveModelId = dependencies.resolveModelId ?? resolveModel
        this.resolveTools = dependencies.resolveTools ?? resolveAgentTools
        this.inferAgentKey = dependencies.inferAgentKey ?? inferAgentKeyFromTools
        this.createProvider = dependencies.createProvider
            ?? (() => new AISDKProviderAdapter(resolveLanguageModel))
        this.createToolRegistry = dependencies.createToolRegistry ?? (() => new ToolRegistry())
    }

    create(snapshotInput: AgentRuntimeConfigSnapshot): AgentRuntimeDescriptor {
        const normalized = normalizeSnapshot(snapshotInput)
        const agentKey = this.inferAgentKey(normalized.tools)
        const tools = this.resolveTools(agentKey, normalized.tools)
        const modelId = this.resolveModelId(normalized.modelProfile).trim()
        if (!modelId) throw new Error('Agent runtime modelId cannot be empty')

        const toolNames = Object.freeze(tools.map((tool) => tool.name))
        const snapshot = Object.freeze<ResolvedAgentRuntimeSnapshot>({
            name: normalized.name,
            description: normalized.description ?? '',
            systemPrompt: normalized.systemPrompt ?? 'You are a helpful assistant.',
            modelProfile: normalized.modelProfile,
            modelId,
            maxSteps: normalized.maxSteps,
            agentKey,
            toolNames,
        })
        const config = Object.freeze<AgentConfig>({
            name: snapshot.name,
            description: snapshot.description,
            systemPrompt: snapshot.systemPrompt,
            modelProfile: snapshot.modelProfile,
            modelId: snapshot.modelId,
            maxSteps: snapshot.maxSteps,
            tools: Object.freeze([...tools]) as Tool[],
        })

        return Object.freeze({
            agent: new (class extends BaseAgent {})(
                config,
                this.createProvider(),
                this.createToolRegistry(),
            ),
            agentKey,
            modelId,
            toolNames,
            snapshot,
            fingerprint: createFingerprint(snapshot),
        })
    }
}

export const defaultAgentRuntimeFactory = new AgentRuntimeFactory()
