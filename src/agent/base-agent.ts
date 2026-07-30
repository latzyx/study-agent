import type {Agent, AgentConfig, AgentEvent, AgentRunOptions} from './types/agent'
import type {Tool} from '../tools/domain/tool'
import type {LLMProvider} from '../llm/domain/llm-provider'
import type {ToolRegistry} from '../tools/registry/tool-registry'

export abstract class BaseAgent implements Agent {
    constructor(
        public config: AgentConfig,
        protected readonly llmProvider: LLMProvider,
        protected readonly toolRegistry: ToolRegistry,
    ) {
        this.registerTools()
    }

    abstract getTools(): Tool[]

    protected registerTools(): void {
        for (const tool of this.getTools()) this.toolRegistry.register(tool)
    }

    async *run(input: string, options: AgentRunOptions = {}): AsyncGenerator<AgentEvent> {
        const messages = [
            {role: 'system' as const, content: this.config.systemPrompt},
            ...(options.history ?? []).filter((message) => message.role !== 'system'),
            {role: 'user' as const, content: input},
        ]
        const tools = this.toolRegistry.list().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as any,
        }))
        const maxSteps = this.config.maxSteps ?? 5
        const model = this.config.modelId ?? this.config.modelProfile

        for (let step = 1; step <= maxSteps; step++) {
            let hasToolCall = false
            let fullText = ''

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
                    hasToolCall = true
                    yield {type: 'tool-call', toolCall: event.toolCall}

                    try {
                        const result = await this.toolRegistry.execute(event.toolCall, {
                            ...options.toolContext,
                            abortSignal: options.abortSignal,
                        })
                        yield {
                            type: 'tool-result',
                            toolResult: {
                                toolCallId: event.toolCall.id,
                                name: event.toolCall.name,
                                result,
                            },
                        }

                        if (fullText.trim()) {
                            messages.push({role: 'assistant', content: fullText})
                        }
                        messages.push({
                            role: 'user',
                            content: `Tool ${event.toolCall.name} result: ${JSON.stringify(result)}`,
                        })
                    } catch (error) {
                        yield {
                            type: 'error',
                            error: error instanceof Error ? error : new Error(String(error)),
                        }
                        return
                    }

                    break
                }

                if (event.type === 'finish') {
                    yield {type: 'finish', usage: event.response.usage}
                    return
                }

                if (event.type === 'error') {
                    yield {type: 'error', error: event.error}
                    return
                }
            }

            if (!hasToolCall) return
        }

        yield {
            type: 'error',
            error: new Error(`Agent exceeded max steps: ${maxSteps}`),
        }
    }
}
