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
import type {Tool, ToolContext} from '../src/tools/domain/tool'
import {ToolRegistry} from '../src/tools/registry/tool-registry'

class FakeLLMProvider implements LLMProvider {
    readonly requests: LLMRequest[] = []

    async generate(_request: LLMRequest): Promise<LLMResponse> {
        throw new Error('Not used by this test')
    }

    async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
        this.requests.push(request)

        if (this.requests.length === 1) {
            yield {
                type: 'tool-call',
                toolCall: {id: 'call-add', name: 'add', input: {a: 2, b: 3}},
            }
            yield {
                type: 'tool-call',
                toolCall: {id: 'call-multiply', name: 'multiply', input: {a: 4, b: 5}},
            }
            yield {
                type: 'finish',
                response: {
                    text: '',
                    toolCalls: [],
                    finishReason: 'tool-calls',
                    usage: {inputTokens: 10, outputTokens: 2, totalTokens: 12},
                },
            }
            return
        }

        yield {type: 'text-delta', text: '计算完成'}
        yield {
            type: 'finish',
            response: {
                text: '计算完成',
                toolCalls: [],
                finishReason: 'stop',
                usage: {inputTokens: 20, outputTokens: 4, totalTokens: 24},
            },
        }
    }
}

function createMathTool(
    name: string,
    operation: (a: number, b: number) => number,
    contexts: ToolContext[],
): Tool<{a: number; b: number}, number> {
    return {
        name,
        description: `${name} two numbers`,
        inputSchema: z.object({a: z.number(), b: z.number()}),
        async execute(input, context) {
            contexts.push(context)
            return operation(input.a, input.b)
        },
    }
}

class TestAgent extends BaseAgent {
    constructor(
        config: AgentConfig,
        provider: LLMProvider,
        registry: ToolRegistry,
        private readonly tools: Tool[],
    ) {
        super(config, provider, registry)
    }

    getTools(): Tool[] {
        return this.tools
    }
}

const config: AgentConfig = {
    name: 'math-agent',
    description: 'test agent',
    systemPrompt: 'You are a calculator.',
    modelProfile: 'general',
    modelId: 'lmstudio:test-model',
    maxSteps: 3,
}

describe('BaseAgent', () => {
    test('passes history and executes every tool call in a step', async () => {
        const contexts: ToolContext[] = []
        const provider = new FakeLLMProvider()
        const registry = new ToolRegistry()
        const tools = [
            createMathTool('add', (a, b) => a + b, contexts),
            createMathTool('multiply', (a, b) => a * b, contexts),
        ]
        const agent = new TestAgent(config, provider, registry, tools)

        const events: AgentEvent[] = []
        for await (const event of agent.run('继续计算', {
            history: [
                {role: 'user', content: '上一个问题'},
                {role: 'assistant', content: '上一个答案'},
            ],
            toolContext: {userId: 'user-1', sessionId: 'session-1'},
        })) {
            events.push(event)
        }

        expect(events.filter((event) => event.type === 'tool-call')).toHaveLength(2)
        expect(events.filter((event) => event.type === 'tool-result')).toHaveLength(2)
        expect(events.some((event) => event.type === 'text-delta' && event.text === '计算完成')).toBe(true)
        expect(events.at(-1)?.type).toBe('finish')

        expect(contexts).toEqual([
            {userId: 'user-1', sessionId: 'session-1', abortSignal: undefined},
            {userId: 'user-1', sessionId: 'session-1', abortSignal: undefined},
        ])
        expect(provider.requests).toHaveLength(2)
        expect(provider.requests[0]?.model).toBe('lmstudio:test-model')
        expect(provider.requests[0]?.messages).toContainEqual({role: 'user', content: '上一个问题'})
        expect(provider.requests[0]?.messages).toContainEqual({role: 'assistant', content: '上一个答案'})
        expect(provider.requests[1]?.messages).toContainEqual({
            role: 'assistant',
            content: '',
            toolCalls: [
                {id: 'call-add', name: 'add', input: {a: 2, b: 3}},
                {id: 'call-multiply', name: 'multiply', input: {a: 4, b: 5}},
            ],
        })
        expect(provider.requests[1]?.messages).toContainEqual({
            role: 'tool',
            name: 'add',
            toolCallId: 'call-add',
            content: '5',
        })
        expect(provider.requests[1]?.messages).toContainEqual({
            role: 'tool',
            name: 'multiply',
            toolCallId: 'call-multiply',
            content: '20',
        })
    })

    test('only exposes tools declared by the current agent', async () => {
        const contexts: ToolContext[] = []
        const registry = new ToolRegistry()
        const unrelatedTool = createMathTool('unrelated', (a, b) => a - b, contexts)
        registry.register(unrelatedTool)

        const provider = new FakeLLMProvider()
        const agent = new TestAgent(
            config,
            provider,
            registry,
            [
                createMathTool('add', (a, b) => a + b, contexts),
                createMathTool('multiply', (a, b) => a * b, contexts),
            ],
        )

        for await (const _event of agent.run('继续计算')) {
            // consume stream
        }

        expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['add', 'multiply'])
    })

    test('rejects empty input before calling the model', async () => {
        const provider = new FakeLLMProvider()
        const agent = new TestAgent(config, provider, new ToolRegistry(), [])
        const events: AgentEvent[] = []

        for await (const event of agent.run('   ')) events.push(event)

        expect(provider.requests).toHaveLength(0)
        expect(events).toHaveLength(1)
        expect(events[0]?.type).toBe('error')
    })
})

describe('ToolRegistry', () => {
    test('rejects invalid input and duplicate tool names', async () => {
        const registry = new ToolRegistry()
        const contexts: ToolContext[] = []
        const add = createMathTool('add', (a, b) => a + b, contexts)

        registry.register(add)
        registry.register(add)
        expect(() => registry.register(createMathTool('add', (a, b) => a + b, contexts)))
            .toThrow('Tool already registered: add')

        await expect(registry.execute({id: 'bad', name: 'add', input: {a: 1}})).rejects.toThrow()
    })
})
