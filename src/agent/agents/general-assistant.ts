import {BaseAgent} from '../base-agent'
import type {Tool} from '../../tools/domain/tool'
import {calculatorTool} from '../../tools/builtin/calculator.tool'
import {currentTimeTool} from '../../tools/builtin/current-time.tool'
import type {LLMProvider} from '../../llm/domain/llm-provider'
import type {ToolRegistry} from '../../tools/registry/tool-registry'
import type {AgentConfig} from '../types/agent'

export const generalAssistantConfig: AgentConfig = {
    name: 'general-assistant',
    description: '通用助手，可以处理各种日常任务',
    systemPrompt: `你是一个通用助手，可以帮助用户处理各种任务。
你可以：
- 回答问题
- 进行计算
- 提供时间信息
- 进行对话

请用中文回复用户。`,
    modelProfile: 'general',
    maxSteps: 5,
}

export class GeneralAssistant extends BaseAgent {
    constructor(
        llmProvider: LLMProvider,
        toolRegistry: ToolRegistry,
    ) {
        super(generalAssistantConfig, llmProvider, toolRegistry)
    }

    override getTools(): Tool[] {
        return [calculatorTool, currentTimeTool]
    }
}
