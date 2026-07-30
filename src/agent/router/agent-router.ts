import type { Agent, AgentConfig } from "../types/agent";
import type { LLMProvider } from "../../llm/domain/llm-provider";

export class AgentRouter {
    private agents: Map<string, Agent>;
    private llmProvider: LLMProvider | null;
    
    constructor(llmProvider?: LLMProvider) {
        this.agents = new Map();
        this.llmProvider = llmProvider || null;
    }
    
    setLLMProvider(provider: LLMProvider): void {
        this.llmProvider = provider;
    }
    
    registerAgent(agent: Agent): void {
        this.agents.set(agent.config.name, agent);
    }
    
    async route(input: string): Promise<Agent> {
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
            lowerInput.includes("排序") || lowerInput.includes("算法") || lowerInput.includes("脚本")) {
            const agent = this.agents.get("code-assistant");
            if (agent) return agent;
        }
        
        // 数据相关关键词
        if (lowerInput.includes("数据") || lowerInput.includes("分析") || lowerInput.includes("data") ||
            lowerInput.includes("统计") || lowerInput.includes("趋势") || lowerInput.includes("销售")) {
            const agent = this.agents.get("data-analyst");
            if (agent) return agent;
        }
        
        // 默认使用通用助手
        return this.getDefaultAgent();
    }
    
    private async routeByLLM(input: string): Promise<Agent> {
        const agentList = Array.from(this.agents.values());
        const agentDescriptions = agentList.map(a => 
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
            const agent = this.agents.get(agentName);
            if (agent) {
                return agent;
            }
            
            // 尝试模糊匹配
            for (const [name, agent] of this.agents) {
                if (agentName.includes(name) || name.includes(agentName)) {
                    return agent;
                }
            }
            
            // 如果 LLM 返回的名称无法匹配，使用关键词回退
            console.log(`[Router] LLM 返回 "${agentName}"，无法匹配，使用关键词路由`);
            return this.routeByKeywords(input);
            
        } catch (error) {
            console.error("[Router] LLM 路由失败，使用关键词路由:", error);
            return this.routeByKeywords(input);
        }
    }
    
    private getDefaultAgent(): Agent {
        const defaultAgent = this.agents.get("general-assistant");
        if (defaultAgent) return defaultAgent;
        
        const firstAgent = this.agents.values().next().value;
        if (firstAgent) return firstAgent;
        
        throw new Error("No agents available");
    }
    
    getAgent(name: string): Agent | undefined {
        return this.agents.get(name);
    }
    
    listAgents(): AgentConfig[] {
        return Array.from(this.agents.values()).map(agent => agent.config);
    }
    
    hasAgent(name: string): boolean {
        return this.agents.has(name);
    }
}
