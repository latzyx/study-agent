import type { LLMProvider, LLMRequest, LLMResponse, LLMToolCall } from "../domain/llm-provider";
import { generateText } from "ai";
import { z } from "zod";

export class AISDKProviderAdapter implements LLMProvider {
    private model: any;

    constructor(model: any) {
        this.model = model;
    }

    async generate(request: LLMRequest): Promise<LLMResponse> {
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

    async *stream(request: LLMRequest): AsyncIterable<any> {
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

        const result = await generateText({
            model: this.model,
            instructions: instructions || undefined,
            messages: messages.length > 0 ? messages : undefined,
            tools: Object.keys(tools).length > 0 ? tools : undefined,
        });

        yield* result.textStream;
    }
}
