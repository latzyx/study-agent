import type {Agent, AgentConfig, AgentEvent, AgentRunOptions} from './types/agent'
import type {LLMProvider, LLMToolCall, LLMUsage} from '../llm/domain/llm-provider'
import type {Tool} from '../tools/domain/tool'
import type {ToolRegistry} from '../tools/registry/tool-registry'

export abstract class BaseAgent implements Agent {
    private toolsRegistered = false

    constructor(
        public config: AgentConfig,
        protected readonly llmProvider: LLMProvider,
        protected readonly toolRegistry: ToolRegistry,
    ) {}

    abstract getTools(): Tool[]

    private ensureToolsRegistered(): void {
        if (this.toolsRegistered) return

        for (const tool of this.getTools()) this.toolRegistry.register(tool)
        this.toolsRegistered = true
    }

    async *run(input: string, options: AgentRunOptions = {}): AsyncGenerator<AgentEvent> {
        this.ensureToolsRegistered()

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
            const pendingToolCalls: LLMToolCall[] = []
            let fullText = ''
            let usage: LLMUsage | undefined

            for await (const event of this.llmProvider.stream({
                model,
                messages,
                tools,
                abortSignal: options.abortSignal,
                telemetry: options.trace?.telemetryForStep(step, model),
            })) {
                if (event.type === 'text-delta') {
                    fullText += event.text
                    yield {type: 'text-delta', text: event.text}
                    continue
                }

                if (event.type === 'tool-call') {
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

            if (fullText.trim()) {
                messages.push({role: 'assistant', content: fullText})
            }

            for (const toolCall of pendingToolCalls) {
                const startedAt = performance.now()
                options.trace?.toolStarted(step, toolCall)

                try {
                    const result = await this.toolRegistry.execute(toolCall, {
                        ...options.toolContext,
                        abortSignal: options.abortSignal,
                    })
                    options.trace?.toolFinished(
                        step,
                        toolCall,
                        {success: true, result},
                        Math.max(0, Math.round(performance.now() - startedAt)),
                    )
                    yield {
                        type: 'tool-result',
                        toolResult: {
                            toolCallId: toolCall.id,
                            name: toolCall.name,
                            result,
                        },
                    }
                    messages.push({
                        role: 'user',
                        content: `Tool ${toolCall.name} result: ${JSON.stringify(result)}`,
                    })
                } catch (error) {
                    const normalizedError = error instanceof Error ? error : new Error(String(error))
                    options.trace?.toolFinished(
                        step,
                        toolCall,
                        {success: false, error: normalizedError},
                        Math.max(0, Math.round(performance.now() - startedAt)),
                    )
                    yield {
                        type: 'error',
                        error: normalizedError,
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
