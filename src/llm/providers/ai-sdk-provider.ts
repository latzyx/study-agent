import {
    dynamicTool,
    generateText,
    streamText,
    type LanguageModel,
    type ModelMessage,
    type ToolSet,
} from 'ai'
import type {
    LLMProvider,
    LLMRequest,
    LLMResponse,
    LLMStreamEvent,
    LLMToolCall,
    LLMUsage,
} from '../domain/llm-provider'
import {LLMProviderError} from '../domain/llm-provider'

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

function getErrorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined

    const statusCode = Reflect.get(error, 'statusCode')
    if (typeof statusCode === 'number') return statusCode

    const status = Reflect.get(error, 'status')
    return typeof status === 'number' ? status : undefined
}

function getErrorName(error: unknown): string {
    if (!error || typeof error !== 'object') return ''
    const name = Reflect.get(error, 'name')
    return typeof name === 'string' ? name : ''
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return typeof error === 'string' ? error : 'Unknown LLM provider error'
}

function classifyError(error: unknown, timedOut: boolean): LLMProviderError {
    if (error instanceof LLMProviderError) return error

    const status = getErrorStatus(error)
    const name = getErrorName(error)
    const message = getErrorMessage(error)
    const normalized = `${name} ${message}`.toLowerCase()

    if (timedOut) {
        return new LLMProviderError('LLM provider request timed out', 'TIMEOUT', true, {cause: error})
    }

    if (name === 'AbortError' || normalized.includes('aborted')) {
        return new LLMProviderError('LLM provider request was aborted', 'ABORTED', false, {cause: error})
    }

    if (status === 401 || status === 403) {
        return new LLMProviderError('LLM provider authentication failed', 'AUTHENTICATION', false, {cause: error})
    }

    if (status === 429 || normalized.includes('rate limit')) {
        return new LLMProviderError('LLM provider rate limit exceeded', 'RATE_LIMITED', true, {cause: error})
    }

    if (status === 400 || status === 404 || status === 422) {
        return new LLMProviderError('LLM provider rejected the request', 'INVALID_REQUEST', false, {cause: error})
    }

    if ((status !== undefined && status >= 500) || normalized.includes('connection') || normalized.includes('unavailable')) {
        return new LLMProviderError('LLM provider is unavailable', 'PROVIDER_UNAVAILABLE', true, {cause: error})
    }

    return new LLMProviderError(message, 'UNKNOWN', false, {cause: error})
}

function createRequestSignal(request: LLMRequest): {
    signal: AbortSignal | undefined
    didTimeout: () => boolean
    dispose: () => void
} {
    if (!request.timeoutMs || request.timeoutMs <= 0) {
        return {
            signal: request.abortSignal,
            didTimeout: () => false,
            dispose: () => undefined,
        }
    }

    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = () => controller.abort(request.abortSignal?.reason)

    if (request.abortSignal?.aborted) {
        abortFromCaller()
    } else {
        request.abortSignal?.addEventListener('abort', abortFromCaller, {once: true})
    }

    const timer = setTimeout(() => {
        timedOut = true
        controller.abort(new Error(`LLM request exceeded ${request.timeoutMs}ms`))
    }, request.timeoutMs)

    return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        dispose: () => {
            clearTimeout(timer)
            request.abortSignal?.removeEventListener('abort', abortFromCaller)
        },
    }
}

function createTools(request: LLMRequest): ToolSet | undefined {
    const definitions = request.tools ?? []
    if (definitions.length === 0) return undefined

    const tools: ToolSet = {}
    for (const definition of definitions) {
        if (tools[definition.name]) {
            throw new LLMProviderError(
                `Duplicate LLM tool definition: ${definition.name}`,
                'INVALID_REQUEST',
                false,
            )
        }

        tools[definition.name] = dynamicTool({
            description: definition.description,
            inputSchema: definition.inputSchema,
        })
    }

    return tools
}

function toModelMessages(request: LLMRequest): {
    instructions: string | undefined
    messages: ModelMessage[]
} {
    const instructions: string[] = []
    const messages: ModelMessage[] = []

    for (const message of request.messages) {
        if (message.role === 'system') {
            instructions.push(message.content)
            continue
        }

        if (message.role === 'assistant' && message.toolCalls?.length) {
            messages.push({
                role: 'assistant',
                content: [
                    ...(message.content ? [{type: 'text' as const, text: message.content}] : []),
                    ...message.toolCalls.map((toolCall) => ({
                        type: 'tool-call' as const,
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        input: toolCall.input,
                    })),
                ],
            })
            continue
        }

        if (message.role === 'tool') {
            if (!message.name || !message.toolCallId) {
                throw new LLMProviderError(
                    'Tool messages require name and toolCallId',
                    'INVALID_REQUEST',
                    false,
                )
            }

            messages.push({
                role: 'tool',
                content: [{
                    type: 'tool-result',
                    toolCallId: message.toolCallId,
                    toolName: message.name,
                    output: {type: 'text', value: message.content},
                }],
            })
            continue
        }

        messages.push({
            role: message.role,
            content: message.content,
        })
    }

    return {
        instructions: instructions.length > 0 ? instructions.join('\n\n') : undefined,
        messages,
    }
}

function normalizeToolCalls(toolCalls: ReadonlyArray<{
    toolCallId: string
    toolName: string
    input: unknown
}>): LLMToolCall[] {
    return toolCalls.map((toolCall) => ({
        id: toolCall.toolCallId,
        name: toolCall.toolName,
        input: toolCall.input,
    }))
}

export class AISDKProviderAdapter implements LLMProvider {
    constructor(private readonly model: LanguageModel) {}

    async generate(request: LLMRequest): Promise<LLMResponse> {
        const {instructions, messages} = toModelMessages(request)
        const tools = createTools(request)
        const requestSignal = createRequestSignal(request)

        try {
            const result = await generateText({
                model: this.model,
                instructions,
                messages,
                tools,
                temperature: request.temperature,
                maxOutputTokens: request.maxOutputTokens,
                abortSignal: requestSignal.signal,
            })

            return {
                text: result.text,
                toolCalls: normalizeToolCalls(result.toolCalls),
                finishReason: result.finishReason,
                usage: toUsage(result.usage),
                raw: result,
            }
        } catch (error) {
            throw classifyError(error, requestSignal.didTimeout())
        } finally {
            requestSignal.dispose()
        }
    }

    async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
        const requestSignal = createRequestSignal(request)

        try {
            const {instructions, messages} = toModelMessages(request)
            const tools = createTools(request)
            const result = streamText({
                model: this.model,
                instructions,
                messages,
                tools,
                temperature: request.temperature,
                maxOutputTokens: request.maxOutputTokens,
                abortSignal: requestSignal.signal,
            })

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
                    yield {
                        type: 'error',
                        error: classifyError(event.error, requestSignal.didTimeout()),
                    }
                    return
                }
            }

            const [text, toolCalls, finishReason, usage] = await Promise.all([
                result.text,
                result.toolCalls,
                result.finishReason,
                result.usage,
            ])
            const normalizedUsage = toUsage(usage)

            if (normalizedUsage) yield {type: 'usage', usage: normalizedUsage}

            yield {
                type: 'finish',
                response: {
                    text,
                    toolCalls: normalizeToolCalls(toolCalls),
                    finishReason,
                    usage: normalizedUsage,
                },
            }
        } catch (error) {
            yield {
                type: 'error',
                error: classifyError(error, requestSignal.didTimeout()),
            }
        } finally {
            requestSignal.dispose()
        }
    }
}
