import type {Tool, ToolContext} from '../domain/tool'
import type {LLMToolCall} from '../../llm/domain/llm-provider'

export class ToolRegistry {
    private readonly tools = new Map<string, Tool>()

    register(tool: Tool): void {
        const existing = this.tools.get(tool.name)
        if (existing === tool) return
        if (existing) throw new Error(`Tool already registered: ${tool.name}`)

        this.tools.set(tool.name, tool)
    }

    get(name: string): Tool {
        const tool = this.tools.get(name)
        if (!tool) throw new Error(`Unknown tool: ${name}`)

        return tool
    }

    async execute(call: LLMToolCall, context: ToolContext = {}): Promise<unknown> {
        const tool = this.get(call.name)
        const input = tool.inputSchema.parse(call.input)
        return tool.execute(input, context)
    }

    list(): Tool[] {
        return [...this.tools.values()]
    }
}
