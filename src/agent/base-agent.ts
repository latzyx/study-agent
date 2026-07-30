import type {Agent, AgentConfig, AgentEvent, AgentRunOptions} from './types/agent'
import type {LLMProvider, LLMToolCall, LLMUsage} from '../llm/domain/llm-provider'
import type {Tool} from '../tools/domain/tool'
import type {ToolRegistry} from '../tools/registry/tool-registry'

export abstract class BaseAgent implements Agent {
    private toolsRegistered = false
    private agentTools: ReadonlyMap<string, Tool> | undefined

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

            this.toolRegistry.register(tool)
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

        const messages = [
            {role: 'system' as const, content: this.config.systemPrompt},
            ...(options.history ?? []).filter((message) => message.role !== 'system'),
            {role: 'user' as const, content: normalizedInput},
        ]
        const tools = [...agentTools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        }))
        const maxSteps = this.config.maxSteps ?? 5
        const model = this.config.modelId ?? this.config.modelProfile

        for (let step = 1; step <= maxSteps; step++) {
            const pendingToolCalls: LLMToolCall[] = []
            let fullText = ''
            let usage: LLMUsage | undefined

            for await (const event of this.llmProvider.stream({
                model,
                messages,
                tools,
                abortSignal: options.abortSignal,
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
                try {
                    const result = await this.toolRegistry.execute(toolCall, {
                        ...options.toolContext,
                        abortSignal: options.abortSignal,
                    })
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
                        content: JSON.stringify(result),
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
