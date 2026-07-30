import type {LLMProvider, LLMRequest, LLMResponse} from "../../llm/domain/llm-provider.ts";
import type {ToolRegistry} from "../../tools/registry/tool-registry.ts";

export interface AgentLoopOptions {
    maxSteps: number;
}

export class AgentLoop {
    constructor(
        private readonly llm: LLMProvider,
        private readonly tools: ToolRegistry,
        private readonly options: AgentLoopOptions,
    ) {
    }

    async run(
        request: LLMRequest,
    ): Promise<LLMResponse> {
        const messages = [...request.messages];

        for (
            let step = 1;
            step <= this.options.maxSteps;
            step++
        ) {
            const response = await this.llm.generate({
                ...request,
                messages,
            });

            messages.push({
                role: "assistant",
                content: response.text,
            });

            if (response.toolCalls.length === 0) {
                return response;
            }

            for (const toolCall of response.toolCalls) {
                const result =
                    await this.tools.execute(toolCall);

                messages.push({
                    role: "tool",
                    toolCallId: toolCall.id,
                    name: toolCall.name,
                    content: JSON.stringify(result),
                });
            }
        }

        throw new Error(
            `Agent exceeded max steps: ${this.options.maxSteps}`,
        );
    }
}
