import {BaseAgent} from '../base-agent'
import type {Tool} from '../../tools/domain/tool'
import type {LLMProvider} from '../../llm/domain/llm-provider'
import type {ToolRegistry} from '../../tools/registry/tool-registry'
import type {AgentConfig} from '../types/agent'

export const codeAssistantConfig: AgentConfig = {
    name: 'code-assistant',
    description: '代码助手，专注于编程和代码相关任务',
    systemPrompt: `你是一个专业的代码助手，专注于编程和代码相关任务。

你可以帮助用户：
- 编写代码
- 调试代码
- 解释代码
- 重构代码
- 提供编程建议
- 回答编程问题

请用中文回复用户，并提供清晰、简洁的代码示例。`,
    modelProfile: 'reasoning',
    maxSteps: 10,
}

export class CodeAssistant extends BaseAgent {
    constructor(
        llmProvider: LLMProvider,
        toolRegistry: ToolRegistry,
    ) {
        super(codeAssistantConfig, llmProvider, toolRegistry)
    }

    override getTools(): Tool[] {
        return []
    }
}
