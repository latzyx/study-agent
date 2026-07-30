import type { LLMProvider, LLMRequest, LLMResponse, LLMToolCall, LLMStreamEvent } from "../domain/llm-provider";
import { generateText, streamText } from "ai";

export class AISDKProviderAdapter implements LLMProvider {
    private model: any;

    constructor(model: any) {
        this.model = model;
    }

    private prepareRequest(request: LLMRequest) {
        let instructions = "";
        const messages: any[] = [];

        for (const msg of request.messages) {
            if (msg.role === "system") {
                instructions = msg.content;
            } else if (msg.role === "user") {
                messages.push({ role: "user" as const, content: msg.content });
            } else if (msg.role === "assistant") {
                messages.push({ role: "assistant" as const, content: msg.content });
            } else if (msg.role === "tool") {
                messages.push({
                    role: "tool" as const,
                    content: msg.content,
                    toolCallId: msg.toolCallId || "",
                });
            }
        }

        const tools: Record<string, any> = {};
        if (request.tools) {
            for (const tool of request.tools) {
                tools[tool.name] = {
                    description: tool.description,
                    parameters: tool.inputSchema,
                };
            }
        }

        return { instructions, messages, tools };
    }

    async generate(request: LLMRequest): Promise<LLMResponse> {
        const { instructions, messages, tools } = this.prepareRequest(request);

        const result = await generateText({
            model: this.model,
            instructions: instructions || undefined,
            messages: messages.length > 0 ? messages : undefined,
            tools: Object.keys(tools).length > 0 ? tools : undefined,
        });

        const toolCalls: LLMToolCall[] = result.toolCalls?.map(tc => ({
            id: tc.toolCallId,
            name: tc.toolName,
            input: tc.args,
        })) || [];

        return {
            text: result.text,
            toolCalls,
            finishReason: result.finishReason,
            usage: result.usage ? {
                inputTokens: result.usage.promptTokens,
                outputTokens: result.usage.completionTokens,
                totalTokens: result.usage.totalTokens,
            } : undefined,
            raw: result,
        };
    }

    async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
        const { instructions, messages, tools } = this.prepareRequest(request);

        const result = streamText({
            model: this.model,
            instructions: instructions || undefined,
            messages: messages.length > 0 ? messages : undefined,
            tools: Object.keys(tools).length > 0 ? tools : undefined,
        });

        // 收集工具调用信息（从增量事件中重建）
        const pendingToolCalls = new Map<string, { name: string; inputJson: string }>();

        for await (const event of result.fullStream) {
            if (event.type === "text-delta") {
                yield { type: "text-delta", text: event.textDelta };
            } else if (event.type === "tool-input-start") {
                pendingToolCalls.set(event.id, { name: event.toolName, inputJson: "" });
            } else if (event.type === "tool-input-delta") {
                const existing = pendingToolCalls.get(event.id);
                if (existing) {
                    existing.inputJson += event.delta;
                }
            } else if (event.type === "tool-call") {
                const existing = pendingToolCalls.get(event.toolCallId);
                const inputJson = existing?.inputJson || "{}";
                let input: Record<string, unknown> = {};
                try {
                    input = JSON.parse(inputJson);
                } catch {
                    // 解析失败使用空对象
                }
                yield {
                    type: "tool-call",
                    toolCall: {
                        id: event.toolCallId,
                        name: event.toolName,
                        input,
                    },
                };
                pendingToolCalls.delete(event.toolCallId);
            }
        }

        // 获取最终结果（用于使用统计）
        const finalResult = await result;

        // 输出使用统计
        if (finalResult.usage) {
            yield {
                type: "usage",
                usage: {
                    inputTokens: finalResult.usage.promptTokens,
                    outputTokens: finalResult.usage.completionTokens,
                    totalTokens: finalResult.usage.totalTokens,
                },
            };
        }

        // 输出完成事件
        yield {
            type: "finish",
            response: {
                text: typeof finalResult.text === 'string' ? finalResult.text : "",
                toolCalls: [],
                finishReason: finalResult.finishReason,
                usage: finalResult.usage ? {
                    inputTokens: finalResult.usage.promptTokens,
                    outputTokens: finalResult.usage.completionTokens,
                    totalTokens: finalResult.usage.totalTokens,
                } : undefined,
            },
        };
    }
}
