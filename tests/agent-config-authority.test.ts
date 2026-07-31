import {describe, expect, test} from 'bun:test'
import {z} from 'zod'
import {BaseAgent} from '../src/agent/base-agent'
import type {AgentConfig, AgentEvent} from '../src/agent/types/agent'
import type {
    LLMProvider,
    LLMRequest,
    LLMResponse,
    LLMStreamEvent,
} from '../src/llm/domain/llm-provider'
import type {Tool} from '../src/tools/domain/tool'
import {ToolRegistry} from '../src/tools/registry/tool-registry'

class RecordingProvider implements LLMProvider {
    readonly requests: LLMRequest[] = []

    async generate(_request: LLMRequest): Promise<LLMResponse> {
        throw new Error('unused')
    }

    async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
        this.requests.push(request)
        yield {
            type: 'finish',
            response: {text: 'done', toolCalls: [], finishReason: 'stop'},
        }
    }
}

class ConfigToolsAgent extends BaseAgent {}

class ConflictingToolsAgent extends BaseAgent {
    constructor(
        config: AgentConfig,
        provider: LLMProvider,
        registry: ToolRegistry,
        private readonly resolvedTools: Tool[],
    ) {
        super(config, provider, registry)
    }

    override getTools(): Tool[] {
        return this.resolvedTools
    }
}

function tool(name: string): Tool<Record<string, never>, string> {
    return {
        name,
        description: name,
        inputSchema: z.object({}),
        async execute() {
            return name
        },
    }
}

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
        name: 'test',
        description: 'test',
        systemPrompt: 'test',
        modelProfile: 'general',
        modelId: 'lmstudio:test-model',
        ...overrides,
    }
}

async function eventsFrom(agent: BaseAgent): Promise<AgentEvent[]> {
    const events: AgentEvent[] = []
    for await (const event of agent.run('hello')) events.push(event)
    return events
}

describe('Agent configuration authority', () => {
    test('does not treat modelProfile as a resolved model id', async () => {
        const provider = new RecordingProvider()
        const agent = new ConfigToolsAgent(
            config({modelId: undefined}),
            provider,
            new ToolRegistry(),
        )

        const events = await eventsFrom(agent)

        expect(provider.requests).toHaveLength(0)
        expect(events[0]?.error?.message).toBe('modelId must be configured')
    })

    test('rejects a non-positive timeout instead of silently disabling it', async () => {
        const provider = new RecordingProvider()
        const agent = new ConfigToolsAgent(
            config({llmTimeoutMs: 0}),
            provider,
            new ToolRegistry(),
        )

        const events = await eventsFrom(agent)

        expect(provider.requests).toHaveLength(0)
        expect(events[0]?.error?.message).toBe('llmTimeoutMs must be a positive integer')
    })

    test('uses config.tools when no custom tool resolver is provided', async () => {
        const provider = new RecordingProvider()
        const agent = new ConfigToolsAgent(
            config({tools: [tool('configured')]}),
            provider,
            new ToolRegistry(),
        )

        await eventsFrom(agent)

        expect(provider.requests[0]?.tools?.map((item) => item.name)).toEqual(['configured'])
    })

    test('rejects conflicting config.tools and getTools results', async () => {
        const provider = new RecordingProvider()
        const agent = new ConflictingToolsAgent(
            config({tools: [tool('configured')]}),
            provider,
            new ToolRegistry(),
            [tool('resolved')],
        )

        const events = await eventsFrom(agent)

        expect(provider.requests).toHaveLength(0)
        expect(events[0]?.error?.message).toContain('one authoritative tool source')
    })
})
