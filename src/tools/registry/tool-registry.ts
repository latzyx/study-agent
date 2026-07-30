import type {Tool, ToolContext} from '../domain/tool'
import type {LLMToolCall} from '../../llm/domain/llm-provider'

export type ToolScope = string | symbol

const GLOBAL_TOOL_SCOPE = Symbol('global-tool-scope')

export class ToolRegistry {
    private readonly scopedTools = new Map<ToolScope, Map<string, Tool>>()

    private getScope(scope: ToolScope = GLOBAL_TOOL_SCOPE): Map<string, Tool> {
        let tools = this.scopedTools.get(scope)
        if (!tools) {
            tools = new Map<string, Tool>()
            this.scopedTools.set(scope, tools)
        }

        return tools
    }

    register(tool: Tool, scope: ToolScope = GLOBAL_TOOL_SCOPE): void {
        const tools = this.getScope(scope)
        const existing = tools.get(tool.name)
        if (existing === tool) return
        if (existing) throw new Error(`Tool already registered in scope: ${tool.name}`)

        tools.set(tool.name, tool)
    }

    get(name: string, scope: ToolScope = GLOBAL_TOOL_SCOPE): Tool {
        const tool = this.getScope(scope).get(name)
        if (!tool) throw new Error(`Unknown tool in scope: ${name}`)

        return tool
    }

    async execute(
        call: LLMToolCall,
        context: ToolContext = {},
        scope: ToolScope = GLOBAL_TOOL_SCOPE,
    ): Promise<unknown> {
        const tool = this.get(call.name, scope)
        const input = tool.inputSchema.parse(call.input)
        return tool.execute(input, context)
    }

    list(scope: ToolScope = GLOBAL_TOOL_SCOPE): Tool[] {
        return [...this.getScope(scope).values()]
    }

    clear(scope: ToolScope = GLOBAL_TOOL_SCOPE): void {
        this.scopedTools.delete(scope)
    }
}