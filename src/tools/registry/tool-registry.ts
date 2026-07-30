import type {Tool} from "../domain/tool";
import type {LLMToolCall} from "../../llm/domain/llm-provider";

export class ToolRegistry {
    private readonly tools =
        new Map<string, Tool>();

    register(tool: Tool): void {
        // 如果工具已存在，跳过注册
        if (this.tools.has(tool.name)) {
            return;
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

        // 确保 input 不是空对象
        const input = call.input && Object.keys(call.input).length > 0
            ? tool.inputSchema.parse(call.input)
            : call.input;

        return tool.execute(input, {});
    }

    list(): Tool[] {
        return [...this.tools.values()];
    }
}
