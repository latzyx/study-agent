import type {Agent, AgentConfig, AgentEvent} from "../types/agent";
import type {Tool} from "../../tools/domain/tool";
import type {LLMProvider} from "../../llm/domain/llm-provider";

export interface MultiAgentConfig {
    name: string;
    description: string;
    agents: Agent[];
    orchestratorPrompt: string;
}

export class MultiAgentSystem implements Agent {
    config: AgentConfig;
    private readonly agents: Agent[];
    private llmProvider: LLMProvider | null;

    constructor(config: MultiAgentConfig, llmProvider?: LLMProvider) {
        this.config = {
            name: config.name,
            description: config.description,
            systemPrompt: config.orchestratorPrompt,
            modelProfile: "reasoning",
        };
        this.agents = config.agents;
        this.llmProvider = llmProvider || null;
    }

    setLLMProvider(provider: LLMProvider): void {
        this.llmProvider = provider;
    }

    getTools(): Tool[] {
        const allTools: Tool[] = [];
        this.agents.forEach(agent => {
            allTools.push(...agent.getTools());
        });
        return allTools;
    }

    async *run(input: string): AsyncGenerator<AgentEvent> {
        const selectedAgent = await this.selectAgent(input);
        yield* selectedAgent.run(input);
    }

    private async selectAgent(input: string): Promise<Agent> {
        // 如果没有 LLM provider，使用简单的关键词匹配
        if (!this.llmProvider) {
            return this.routeByKeywords(input);
        }

        // 使用 LLM 进行智能路由
        return await this.routeByLLM(input);
    }

    private routeByKeywords(input: string): Agent {
        const lowerInput = input.toLowerCase();

        // 代码相关关键词
        if (lowerInput.includes("代码") || lowerInput.includes("编程") || lowerInput.includes("code") ||
            lowerInput.includes("写代码") || lowerInput.includes("函数") || lowerInput.includes("function") ||
            lowerInput.includes("调试") || lowerInput.includes("debug") || lowerInput.includes("bug") ||
            lowerInput.includes("排序") || lowerInput.includes("算法") || lowerInput.includes("脚本") ||
            lowerInput.includes("py") || lowerInput.includes("js") || lowerInput.includes("java")) {
            const agent = this.agents.find(a => a.config.name === "code-assistant");
            if (agent) return agent;
        }

        // 数据相关关键词
        if (lowerInput.includes("数据") || lowerInput.includes("分析") || lowerInput.includes("data") ||
            lowerInput.includes("统计") || lowerInput.includes("趋势") || lowerInput.includes("销售")) {
            const agent = this.agents.find(a => a.config.name === "data-analyst");
            if (agent) return agent;
        }

        // 默认使用通用助手
        return this.getDefaultAgent();
    }

    private async routeByLLM(input: string): Promise<Agent> {
        const agentDescriptions = this.agents.map(a =>
            `- ${a.config.name}: ${a.config.description}`
        ).join("\n");

        const routePrompt = `你是一个路由系统。根据用户输入，选择最合适的 agent 来处理。

可用的 agents:
${agentDescriptions}

用户输入: "${input}"

请只返回一个 agent 的名称（例如: general-assistant、code-assistant、data-analyst），不要返回其他内容。`;

        try {
            const response = await this.llmProvider!.generate({
                model: "lmstudio:google/gemma-4-12b-qat",
                messages: [
                    { role: "system", content: "你是一个路由系统，只返回 agent 名称。" },
                    { role: "user", content: routePrompt }
                ]
            });

            const agentName = response.text.trim().toLowerCase();

            // 查找匹配的 agent
            const agent = this.agents.find(a => a.config.name === agentName);
            if (agent) {
                return agent;
            }

            // 尝试模糊匹配
            for (const agent of this.agents) {
                if (agentName.includes(agent.config.name) || agent.config.name.includes(agentName)) {
                    return agent;
                }
            }

            // 如果 LLM 返回的名称无法匹配，使用关键词回退
            console.log(`[MultiAgent] LLM 返回 "${agentName}"，无法匹配，使用关键词路由`);
            return this.routeByKeywords(input);

        } catch (error) {
            console.error("[MultiAgent] LLM 路由失败，使用关键词路由:", error);
            return this.routeByKeywords(input);
        }
    }

    private getDefaultAgent(): Agent {
        const agent = this.agents.find(a => a.config.name === "general-assistant");
        if (agent) return agent;

        const firstAgent = this.agents[0];
        if (!firstAgent) {
            throw new Error("No agents available");
        }
        return firstAgent;
    }

    listAgents(): AgentConfig[] {
        return this.agents.map(agent => agent.config);
    }
}
