import type {
    LLMMessage,
    LLMTelemetrySettings,
    LLMToolCall,
} from '../../llm/domain/llm-provider'
import type {Tool, ToolContext} from '../../tools/domain/tool'

export type ModelProfile = 'fast' | 'general' | 'reasoning' | 'vision'

export interface AgentConfig {
    name: string
    description: string
    systemPrompt: string
    modelProfile: ModelProfile
    modelId?: string
    maxSteps?: number
    tools?: Tool[]
}

export interface AgentTraceRecorder {
    telemetryForStep(stepNumber: number, model: string): LLMTelemetrySettings | undefined
    toolStarted(stepNumber: number, toolCall: LLMToolCall): void
    toolFinished(
        stepNumber: number,
        toolCall: LLMToolCall,
        outcome: {success: true; result: unknown} | {success: false; error: Error},
        durationMs: number,
    ): void
    flush(): Promise<void>
}

export interface AgentRunOptions {
    history?: LLMMessage[]
    toolContext?: ToolContext
    abortSignal?: AbortSignal
    trace?: AgentTraceRecorder
}

export interface AgentEvent {
    type: 'text-delta' | 'tool-call' | 'tool-result' | 'error' | 'finish'
    stepNumber?: number
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
