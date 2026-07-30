import type { Agent, AgentConfig, AgentEvent } from "./types/agent";
import type { Tool, ToolContext } from "../tools/domain/tool";
import type { LLMProvider } from "../llm/domain/llm-provider";
import type { ToolRegistry } from "../tools/registry/tool-registry";

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
    
    async *run(input: string): AsyncGenerator<AgentEvent> {
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
            
            const response = await this.llmProvider.generate({
                model: `lmstudio:google/gemma-4-12b-qat`,
                messages,
                tools,
            });
            
            if (response.text) {
                yield {
                    type: 'text-delta',
                    text: response.text,
                };
            }
            
            if (response.toolCalls.length === 0) {
                yield {
                    type: 'finish',
                    usage: response.usage,
                };
                return;
            }
            
            for (const toolCall of response.toolCalls) {
                yield {
                    type: 'tool-call',
                    toolCall: {
                        id: toolCall.id,
                        name: toolCall.name,
                        input: toolCall.input,
                    },
                };
                
                try {
                    const result = await this.toolRegistry.execute(toolCall);
                    
                    yield {
                        type: 'tool-result',
                        toolResult: {
                            toolCallId: toolCall.id,
                            name: toolCall.name,
                            result,
                        },
                    };
                    
                    messages.push({
                        role: "assistant",
                        content: response.text || "",
                    });
                    
                    messages.push({
                        role: "tool",
                        toolCallId: toolCall.id,
                        name: toolCall.name,
                        content: JSON.stringify(result),
                    });
                } catch (error) {
                    yield {
                        type: 'error',
                        error: error as Error,
                    };
                    return;
                }
            }
        }
        
        yield {
            type: 'error',
            error: new Error(`Agent exceeded max steps: ${maxSteps}`),
        };
    }
}
