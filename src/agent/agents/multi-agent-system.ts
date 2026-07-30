import type {Agent, AgentConfig, AgentEvent} from "../types/agent";
import type {Tool} from "../../tools/domain/tool";
import type {LLMProvider} from "../../llm/domain/llm-provider";
import type {ToolRegistry} from "../../tools/registry/tool-registry";

export interface MultiAgentConfig {
    name: string;
    description: string;
    agents: Agent[];
    orchestratorPrompt: string;
}

export class MultiAgentSystem implements Agent {
    config: AgentConfig;
    private readonly agents: Agent[];
    private orchestratorPrompt: string;
    private llmProvider: LLMProvider;
    private toolRegistry: ToolRegistry;

    constructor(
        config: MultiAgentConfig,
        llmProvider: LLMProvider,
        toolRegistry: ToolRegistry
    ) {
        this.config = {
            name: config.name,
            description: config.description,
            systemPrompt: config.orchestratorPrompt,
            modelProfile: "reasoning",
        };
        this.agents = config.agents;
        this.orchestratorPrompt = config.orchestratorPrompt;
        this.llmProvider = llmProvider;
        this.toolRegistry = toolRegistry;
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
        const lowerInput = input.toLowerCase();

        if (lowerInput.includes("代码") || lowerInput.includes("编程") || lowerInput.includes("code")) {
            return this.agents.find(a => a.config.name === "code-assistant") || this.agents[0];
        }

        if (lowerInput.includes("数据") || lowerInput.includes("分析") || lowerInput.includes("data")) {
            return this.agents.find(a => a.config.name === "data-analyst") || this.agents[0];
        }

        return this.agents.find(a => a.config.name === "general-assistant") || this.agents[0];
    }

    listAgents(): AgentConfig[] {
        return this.agents.map(agent => agent.config);
    }
}
