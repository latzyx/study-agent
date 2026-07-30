import type {Agent, AgentConfig, AgentEvent, AgentRunOptions} from './types/agent'
import type {
    LLMMessage,
    LLMProvider,
    LLMToolCall,
    LLMUsage,
} from '../llm/domain/llm-provider'
import type {Tool} from '../tools/domain/tool'
import type {ToolRegistry, ToolScope} from '../tools/registry/tool-registry'

const DEFAULT_MAX_STEPS = 5
const DEFAULT_MAX_HISTORY_MESSAGES = 50
const DEFAULT_MAX_TOOL_RESULT_CHARS = 20_000

function normalizePositiveInteger(value: number | undefined, fallback: number, name: string): number {
    if (value === undefined) return fallback
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`)
    }

    return value
}

function serializeToolResult(result: unknown, maxChars: number): string {
    const seen = new WeakSet<object>()
    let serialized: string

    try {
        serialized = JSON.stringify(result, (_key, value: unknown) => {
            if (typeof value === 'bigint') return value.toString()
            if (typeof value !== 'object' || value === null) return value
            if (seen.has(value)) return '[Circular]'
            seen.add(value)
            return value
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        serialized = JSON.stringify({error: 'TOOL_RESULT_SERIALIZATION_FAILED', message})
    }

    if (serialized === undefined) serialized = JSON.stringify(null)
    if (serialized.length <= maxChars) return serialized

    return JSON.stringify({
        truncated: true,
        originalChars: serialized.length,
        content: serialized.slice(0, maxChars),
    })
}

export abstract class BaseAgent implements Agent {
    private toolsRegistered = false
    private agentTools: ReadonlyMap<string, Tool> | undefined
    private readonly toolScope: ToolScope = Symbol('agent-tool-scope')

    constructor(
        public config: AgentConfig,
        protected readonly llmProvider: LLMProvider,
        protected readonly toolRegistry: ToolRegistry,
    ) {}

    abstract getTools(): Tool[]

    private ensureToolsRegistered(): ReadonlyMap<string, Tool> {
        if (this.toolsRegistered && this.agentTools) return this.agentTools

        const tools = this.getTools()
        const toolMap = new Map<string, Tool>()

        for (const tool of tools) {
            if (toolMap.has(tool.name)) {
                throw new Error(`Agent tool declared more than once: ${tool.name}`)
            }

            this.toolRegistry.register(tool, this.toolScope)
            toolMap.set(tool.name, tool)
        }

        this.agentTools = toolMap
        this.toolsRegistered = true
        return toolMap
    }

    async *run(input: string, options: AgentRunOptions = {}): AsyncGenerator<AgentEvent> {
        const agentTools = this.ensureToolsRegistered()
        const normalizedInput = input.trim()

        if (!normalizedInput) {
            yield {type: 'error', error: new Error('Agent input cannot be empty')}
            return
        }

        if (options.abortSignal?.aborted) {
            yield {type: 'error', error: new Error('Agent run was aborted before execution')}
            return
        }

        let maxSteps: number
        let maxHistoryMessages: number
        let maxToolResultChars: number

        try {
            maxSteps = normalizePositiveInteger(this.config.maxSteps, DEFAULT_MAX_STEPS, 'maxSteps')
            maxHistoryMessages = normalizePositiveInteger(
                this.config.maxHistoryMessages,
                DEFAULT_MAX_HISTORY_MESSAGES,
                'maxHistoryMessages',
            )
            maxToolResultChars = normalizePositiveInteger(
                this.config.maxToolResultChars,
                DEFAULT_MAX_TOOL_RESULT_CHARS,
                'maxToolResultChars',
            )
        } catch (error) {
            yield {type: 'error', error: error instanceof Error ? error : new Error(String(error))}
            return
        }

        const history = (options.history ?? [])
            .filter((message) => message.role !== 'system')
            .slice(-maxHistoryMessages)
        const messages: LLMMessage[] = [
            {role: 'system', content: this.config.systemPrompt},
            ...history,
            {role: 'user', content: normalizedInput},
        ]
        const tools = [...agentTools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        }))
        const model = this.config.modelId ?? this.config.modelProfile

        for (let step = 1; step <= maxSteps; step++) {
            const pendingToolCalls: LLMToolCall[] = []
            const pendingToolCallIds = new Set<string>()
            let fullText = ''
            let usage: LLMUsage | undefined

            for await (const event of this.llmProvider.stream({
                model,
                messages,
                tools,
                abortSignal: options.abortSignal,
                timeoutMs: this.config.llmTimeoutMs,
            })) {
                if (event.type === 'text-delta') {
                    fullText += event.text
                    yield {type: 'text-delta', text: event.text}
                    continue
                }

                if (event.type === 'tool-call') {
                    if (!agentTools.has(event.toolCall.name)) {
                        yield {
                            type: 'error',
                            error: new Error(`Model requested a tool not enabled for this agent: ${event.toolCall.name}`),
                        }
                        return
                    }

                    if (!event.toolCall.id || pendingToolCallIds.has(event.toolCall.id)) {
                        yield {
                            type: 'error',
                            error: new Error(`Model returned an invalid or duplicate toolCallId: ${event.toolCall.id}`),
                        }
                        return
                    }

                    pendingToolCallIds.add(event.toolCall.id)
                    pendingToolCalls.push(event.toolCall)
                    yield {type: 'tool-call', toolCall: event.toolCall}
                    continue
                }

                if (event.type === 'usage') {
                    usage = event.usage
                    continue
                }

                if (event.type === 'finish') {
                    usage = event.response.usage ?? usage
                    break
                }

                if (event.type === 'error') {
                    yield {type: 'error', error: event.error}
                    return
                }
            }

            if (pendingToolCalls.length === 0) {
                yield {type: 'finish', usage}
                return
            }

            messages.push({
                role: 'assistant',
                content: fullText,
                toolCalls: pendingToolCalls,
            })

            for (const toolCall of pendingToolCalls) {
                if (options.abortSignal?.aborted) {
                    yield {type: 'error', error: new Error('Agent run was aborted before tool execution')}
                    return
                }

                try {
                    const result = await this.toolRegistry.execute(toolCall, {
                        ...options.toolContext,
                        abortSignal: options.abortSignal,
                    }, this.toolScope)
                    yield {
                        type: 'tool-result',
                        toolResult: {
                            toolCallId: toolCall.id,
                            name: toolCall.name,
                            result,
                        },
                    }
                    messages.push({
                        role: 'tool',
                        name: toolCall.name,
                        toolCallId: toolCall.id,
                        content: serializeToolResult(result, maxToolResultChars),
                    })
                } catch (error) {
                    yield {
                        type: 'error',
                        error: error instanceof Error ? error : new Error(String(error)),
                    }
                    return
                }
            }
        }

        yield {
            type: 'error',
            error: new Error(`Agent exceeded max steps: ${maxSteps}`),
        }
    }
}