import {
    generateText,
    streamText,
    type LanguageModel,
    type ModelMessage,
} from 'ai'
import type {
    LLMProvider,
    LLMRequest,
    LLMResponse,
    LLMStreamEvent,
    LLMToolCall,
    LLMUsage,
} from '../domain/llm-provider'

function toUsage(usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
}): LLMUsage | undefined {
    if (!usage) return undefined

    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
    }
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
}

export class AISDKProviderAdapter implements LLMProvider {
    constructor(private readonly model: LanguageModel) {}

    private prepareRequest(request: LLMRequest) {
        let instructions = ''
        const messages: ModelMessage[] = []

        for (const message of request.messages) {
            if (message.role === 'system') {
                instructions = message.content
                continue
            }

            if (message.role === 'tool') {
                messages.push({
                    role: 'user',
                    content: `Tool ${message.name ?? 'unknown'} result: ${message.content}`,
                })
                continue
            }

            messages.push({
                role: message.role,
                content: message.content,
            })
        }

        const tools: Record<string, {description: string; inputSchema: any}> = {}
        for (const tool of request.tools ?? []) {
            tools[tool.name] = {
                description: tool.description,
                inputSchema: tool.inputSchema,
            }
        }

        return {instructions, messages, tools}
    }

    async generate(request: LLMRequest): Promise<LLMResponse> {
        const {instructions, messages, tools} = this.prepareRequest(request)
        const result = await generateText({
            model: this.model,
            instructions: instructions || undefined,
            messages,
            tools: Object.keys(tools).length > 0 ? tools : undefined,
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            abortSignal: request.abortSignal,
        })

        const toolCalls: LLMToolCall[] = result.toolCalls.map((toolCall) => ({
            id: toolCall.toolCallId,
            name: toolCall.toolName,
            input: toolCall.input,
        }))

        return {
            text: result.text,
            toolCalls,
            finishReason: result.finishReason,
            usage: toUsage(result.usage),
            raw: result,
        }
    }

    async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
        const {instructions, messages, tools} = this.prepareRequest(request)
        const result = streamText({
            model: this.model,
            instructions: instructions || undefined,
            messages,
            tools: Object.keys(tools).length > 0 ? tools : undefined,
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            abortSignal: request.abortSignal,
        })

        try {
            for await (const event of result.fullStream) {
                if (event.type === 'text-delta') {
                    yield {type: 'text-delta', text: event.text}
                } else if (event.type === 'tool-call') {
                    yield {
                        type: 'tool-call',
                        toolCall: {
                            id: event.toolCallId,
                            name: event.toolName,
                            input: event.input,
                        },
                    }
                } else if (event.type === 'error') {
                    yield {type: 'error', error: toError(event.error)}
                    return
                }
            }

            const [text, toolCalls, finishReason, usage] = await Promise.all([
                result.text,
                result.toolCalls,
                result.finishReason,
                result.usage,
            ])
            const normalizedToolCalls: LLMToolCall[] = toolCalls.map((toolCall) => ({
                id: toolCall.toolCallId,
                name: toolCall.toolName,
                input: toolCall.input,
            }))
            const normalizedUsage = toUsage(usage)

            if (normalizedUsage) yield {type: 'usage', usage: normalizedUsage}

            yield {
                type: 'finish',
                response: {
                    text,
                    toolCalls: normalizedToolCalls,
                    finishReason,
                    usage: normalizedUsage,
                },
            }
        } catch (error) {
            yield {type: 'error', error: toError(error)}
        }
    }
}
