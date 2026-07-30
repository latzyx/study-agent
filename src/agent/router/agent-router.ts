import type { Agent, AgentConfig } from "../types/agent";

export class AgentRouter {
    private agents: Map<string, Agent>;
    
    constructor() {
        this.agents = new Map();
    }
    
    registerAgent(agent: Agent): void {
        this.agents.set(agent.config.name, agent);
    }
    
    route(input: string): Agent {
        const lowerInput = input.toLowerCase();
        
        // 根据关键词选择agent
        if (lowerInput.includes("代码") || lowerInput.includes("编程") || lowerInput.includes("code")) {
            const agent = this.agents.get("code-assistant");
            if (agent) return agent;
        }
        
        if (lowerInput.includes("数据") || lowerInput.includes("分析") || lowerInput.includes("data")) {
            const agent = this.agents.get("data-analyst");
            if (agent) return agent;
        }
        
        // 默认使用通用助手
        const defaultAgent = this.agents.get("general-assistant");
        if (defaultAgent) return defaultAgent;
        
        // 如果没有找到任何agent，返回第一个可用的agent
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
