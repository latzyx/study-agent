import { z } from "zod";
import { streamText, isStepCount, tool } from "ai";

import { providerRegistry } from "./src/llm/registry/provider-registry.ts";
import { resolveModel } from "./src/llm/registry/model-registry.ts";
import { calculatorTool } from "./src/tools/builtin/calculator.tool";
import { currentTimeTool } from "./src/tools/builtin/current-time.tool";
import { GeneralAssistant } from "./src/agent/agents/general-assistant";
import { CodeAssistant } from "./src/agent/agents/code-assistant";
import { DataAnalyst } from "./src/agent/agents/data-analyst";
import { MultiAgentSystem } from "./src/agent/agents/multi-agent-system";
import { AgentRouter } from "./src/agent/router/agent-router";
import { ToolRegistry } from "./src/tools/registry/tool-registry";
import { AISDKProviderAdapter } from "./src/llm/providers/ai-sdk-provider";
import { MockProvider } from "./src/llm/providers/mock-provider";

async function main(): Promise<void> {
    // 创建LLM提供者 (使用mock provider进行测试)
    const llmProvider = new MockProvider("你好，我是通用助手。我可以帮你处理各种任务。");
    
    // 创建工具注册表
    const toolRegistry = new ToolRegistry();
    
    // 创建agent
    const generalAssistant = new GeneralAssistant(llmProvider, toolRegistry);
    const codeAssistant = new CodeAssistant(llmProvider, toolRegistry);
    const dataAnalyst = new DataAnalyst(llmProvider, toolRegistry);
    
    // 创建多agent协作系统
    const multiAgentSystem = new MultiAgentSystem(
        {
            name: "multi-agent",
            description: "多agent协作系统",
            agents: [generalAssistant, codeAssistant, dataAnalyst],
            orchestratorPrompt: "你是一个协调者，负责将任务分配给最合适的agent。",
        },
        llmProvider,
        toolRegistry
    );
    
    // 创建路由器并注册agent
    const router = new AgentRouter();
    router.registerAgent(generalAssistant);
    router.registerAgent(codeAssistant);
    router.registerAgent(dataAnalyst);
    router.registerAgent(multiAgentSystem);
    
    // 测试执行
    const testInputs = [
        "123 * 456",  // 应该选择通用助手
        "帮我写一个Python函数",  // 应该选择代码助手
        "分析这个数据集的趋势",  // 应该选择数据分析
        "你好",  // 应该选择通用助手
    ];
    
    for (const input of testInputs) {
        console.log(`\n输入: ${input}`);
        const agent = router.route(input);
        console.log(`选择的Agent: ${agent.config.name}`);
        
        // 执行agent
        for await (const event of agent.run(input)) {
            switch (event.type) {
                case 'text-delta':
                    process.stdout.write(event.text || '');
                    break;
                case 'tool-call':
                    console.log(`\n调用工具: ${event.toolCall?.name}`);
                    break;
                case 'tool-result':
                    console.log(`工具结果: ${JSON.stringify(event.toolResult?.result)}`);
                    break;
                case 'finish':
                    console.log('\n执行完成');
                    break;
                case 'error':
                    console.error(`错误: ${event.error?.message}`);
                    break;
            }
        }
    }
}

main().catch((error: unknown) => {
    console.error("执行失败：", error);
    process.exitCode = 1;
});
