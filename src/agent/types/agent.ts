import type {LLMMessage} from '../../llm/domain/llm-provider'
import type {Tool, ToolContext} from '../../tools/domain/tool'

export type ModelProfile = 'fast' | 'general' | 'reasoning' | 'vision'

export interface AgentConfig {
    name: string
    description: string
    systemPrompt: string
    modelProfile: ModelProfile
    modelId?: string
    maxSteps?: number
    maxHistoryMessages?: number
    llmTimeoutMs?: number
    maxToolResultChars?: number
    tools?: Tool[]
}

export interface AgentRunOptions {
    history?: LLMMessage[]
    toolContext?: ToolContext
    abortSignal?: AbortSignal
}

export interface AgentEvent {
    type: 'text-delta' | 'tool-call' | 'tool-result' | 'error' | 'finish'
    text?: string
    toolCall?: {
        id: string
        name: string
        input: unknown
    }
    toolResult?: {
        toolCallId: string
        name: string
        result: unknown
    }
    error?: Error
    usage?: {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
    }
}

export interface Agent {
    config: AgentConfig

    run(input: string, options?: AgentRunOptions): AsyncGenerator<AgentEvent>

    getTools(): Tool[]
}
