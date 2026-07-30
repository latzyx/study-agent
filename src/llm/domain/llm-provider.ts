import type {ZodType} from 'zod'

export type LLMRole =
    | 'system'
    | 'user'
    | 'assistant'
    | 'tool'

export interface LLMToolCall {
    id: string
    name: string
    input: unknown
}

export interface LLMMessage {
    role: LLMRole
    content: string
    name?: string
    toolCallId?: string
    toolCalls?: LLMToolCall[]
}

export interface LLMToolDefinition {
    name: string
    description: string
    inputSchema: ZodType<unknown>
}

export interface LLMUsage {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
}

export type LLMProviderErrorCode =
    | 'ABORTED'
    | 'TIMEOUT'
    | 'AUTHENTICATION'
    | 'RATE_LIMITED'
    | 'INVALID_REQUEST'
    | 'PROVIDER_UNAVAILABLE'
    | 'UNKNOWN'

export class LLMProviderError extends Error {
    readonly name = 'LLMProviderError'

    constructor(
        message: string,
        readonly code: LLMProviderErrorCode,
        readonly retryable: boolean,
        options?: ErrorOptions,
    ) {
        super(message, options)
    }
}

export interface LLMRequest {
    model: string
    messages: LLMMessage[]
    tools?: LLMToolDefinition[]
    temperature?: number
    maxOutputTokens?: number
    abortSignal?: AbortSignal
    timeoutMs?: number
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
