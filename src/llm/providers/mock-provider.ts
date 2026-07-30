import type { LLMProvider, LLMRequest, LLMResponse } from "../domain/llm-provider";

export class MockProvider implements LLMProvider {
    private responseText: string;
    private toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

    constructor(responseText: string = "你好，我是通用助手。") {
        this.responseText = responseText;
    }

    addToolCall(name: string, input: Record<string, unknown>): void {
        this.toolCalls.push({ name, input });
    }

    async generate(request: LLMRequest): Promise<LLMResponse> {
        const toolCalls = this.toolCalls.splice(0).map((tc, index) => ({
            id: `mock-tool-call-${index}`,
            name: tc.name,
            input: tc.input,
        }));

        return {
            text: this.responseText,
            toolCalls,
            finishReason: toolCalls.length > 0 ? "tool-calls" : "stop",
            usage: {
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
            },
        };
    }

    async *stream(request: LLMRequest): AsyncIterable<any> {
        yield this.responseText;
    }
}
