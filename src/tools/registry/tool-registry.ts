import type {Tool} from "../domain/tool";
import type {LLMToolCall} from "../../llm/domain/llm-provider";

export class ToolRegistry {
    private readonly tools =
        new Map<string, Tool>();

    register(tool: Tool): void {
        if (this.tools.has(tool.name)) {
            // Skip if same tool is already registered
            const existing = this.tools.get(tool.name);
            if (existing === tool) {
                return;
            }
            throw new Error(
                `Tool already registered: ${tool.name}`,
            );
        }

        this.tools.set(tool.name, tool);
    }

    get(name: string): Tool {
        const tool = this.tools.get(name);

        if (!tool) {
            throw new Error(
                `Unknown tool: ${name}`,
            );
        }

        return tool;
    }

    async execute(
        call: LLMToolCall,
    ): Promise<unknown> {
        const tool = this.get(call.name);

        const input =
            tool.inputSchema.parse(call.input);

        return tool.execute(input, {});
    }

    list(): Tool[] {
        return [...this.tools.values()];
    }
}
