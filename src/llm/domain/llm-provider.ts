export type LLMRole =
    | 'system'
    | 'user'
    | 'assistant'
    | 'tool'

export interface LLMMessage {
    role: LLMRole
    content: string
    name?: string
    toolCallId?: string
}

export interface LLMToolDefinition {
    name: string
    description: string
    inputSchema: Record<string, unknown>
}

export interface LLMToolCall {
    id: string
    name: string
    input: unknown
}

export interface LLMUsage {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
}

export type LLMTelemetryMetadataValue =
    | string
    | number
    | boolean
    | Array<null | undefined | string>
    | Array<null | undefined | number>
    | Array<null | undefined | boolean>

export interface LLMTelemetrySettings {
    isEnabled: boolean
    recordInputs?: boolean
    recordOutputs?: boolean
    functionId?: string
    metadata?: Record<string, LLMTelemetryMetadataValue>
    integrations?: unknown[]
}

export interface LLMRequest {
    model: string
    messages: LLMMessage[]
    tools?: LLMToolDefinition[]
    temperature?: number
    maxOutputTokens?: number
    abortSignal?: AbortSignal
    telemetry?: LLMTelemetrySettings
}

export interface LLMResponse {
    id?: string
    model?: string
    text: string
    toolCalls: LLMToolCall[]
    finishReason?: string
    usage?: LLMUsage
    raw?: unknown
}

export type LLMStreamEvent =
    | {
    type: 'text-delta'
    text: string
}
    | {
    type: 'tool-call'
    toolCall: LLMToolCall
}
    | {
    type: 'usage'
    usage: LLMUsage
}
    | {
    type: 'finish'
    response: LLMResponse
}
    | {
    type: 'error'
    error: Error
}

export interface LLMProvider {
    generate(request: LLMRequest): Promise<LLMResponse>

    stream(
        request: LLMRequest,
    ): AsyncIterable<LLMStreamEvent>
}
