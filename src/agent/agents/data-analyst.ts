import {BaseAgent} from '../base-agent'
import type {Tool} from '../../tools/domain/tool'
import {calculatorTool} from '../../tools/builtin/calculator.tool'
import type {LLMProvider} from '../../llm/domain/llm-provider'
import type {ToolRegistry} from '../../tools/registry/tool-registry'
import type {AgentConfig} from '../types/agent'

export const dataAnalystConfig: AgentConfig = {
    name: 'data-analyst',
    description: '数据分析助手，专注于数据处理和分析任务',
    systemPrompt: `你是一个专业的数据分析助手，专注于数据处理和分析任务。

你可以帮助用户：
- 分析数据趋势
- 进行数据计算
- 提供统计分析
- 生成数据可视化建议
- 解读数据结果

请用中文回复用户，并提供清晰的数据分析结果。`,
    modelProfile: 'reasoning',
    maxSteps: 8,
}

export class DataAnalyst extends BaseAgent {
    constructor(
        llmProvider: LLMProvider,
        toolRegistry: ToolRegistry,
    ) {
        super(dataAnalystConfig, llmProvider, toolRegistry)
    }

    override getTools(): Tool[] {
        return [calculatorTool]
    }
}
