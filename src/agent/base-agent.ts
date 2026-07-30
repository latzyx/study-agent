import type {Agent, AgentConfig, AgentEvent} from "./types/agent";
import type {Tool, ToolContext} from "../tools/domain/tool";
import type {LLMProvider} from "../llm/domain/llm-provider";
import type {ToolRegistry} from "../tools/registry/tool-registry";

export abstract class BaseAgent implements Agent {
    config: AgentConfig;
    protected llmProvider: LLMProvider;
    protected toolRegistry: ToolRegistry;

    constructor(
        config: AgentConfig,
        llmProvider: LLMProvider,
        toolRegistry: ToolRegistry
    ) {
        this.config = config;
        this.llmProvider = llmProvider;
        this.toolRegistry = toolRegistry;
        this.registerTools();
    }

    abstract getTools(): Tool[];

    protected registerTools(): void {
        this.getTools().forEach(tool => {
            this.toolRegistry.register(tool);
        });
    }

    async* run(input: string): AsyncGenerator<AgentEvent> {
        const messages = [
            {
                role: "system" as const,
                content: this.config.systemPrompt,
            },
            {
                role: "user" as const,
                content: input,
            },
        ];

        const tools = this.toolRegistry.list().map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as any,
        }));

        let step = 0;
        const maxSteps = this.config.maxSteps || 5;

        while (step < maxSteps) {
            step++;
            let hasToolCall = false;
            let fullText = "";

            for await (const event of this.llmProvider.stream({
                model: `lmstudio:google/gemma-4-12b-qat`,
                messages,
                tools,
            })) {
                if (event.type === "text-delta") {
                    fullText += event.text;
                    yield {
                        type: 'text-delta',
                        text: event.text,
                    };
                } else if (event.type === "tool-call") {
                    hasToolCall = true;
                    yield {
                        type: 'tool-call',
                        toolCall: event.toolCall!,
                    };

                    try {
                        const result = await this.toolRegistry.execute(event.toolCall!);

                        yield {
                            type: 'tool-result',
                            toolResult: {
                                toolCallId: event.toolCall!.id,
                                name: event.toolCall!.name,
                                result,
                            },
                        };

                        messages.push({
                            role: "user",
                            content: `工具 ${event.toolCall!.name} 执行结果: ${JSON.stringify(result)}`,
                        });

                        fullText = "";
                    } catch (error) {
                        yield {
                            type: 'error',
                            error: error as Error,
                        };
                        return;
                    }

                    // 工具调用后跳出 for-await，进入下一轮 while 循环
                    break;
                } else if (event.type === "finish") {
                    yield {
                        type: 'finish',
                        usage: event.response?.usage,
                    };
                    return;
                } else if (event.type === "error") {
                    yield {
                        type: 'error',
                        error: event.error!,
                    };
                    return;
                }
            }

            // 如果没有工具调用，说明 LLM 直接回复了文本，退出循环
            if (!hasToolCall) {
                return;
            }
        }

        yield {
            type: 'error',
            error: new Error(`Agent exceeded max steps: ${maxSteps}`),
        };
    }
}
