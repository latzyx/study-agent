import {createInterface} from 'node:readline/promises'
import {stdin as input, stdout as output} from 'node:process'
import {GeneralAssistant} from './src/agent/agents/general-assistant.js'
import {AISDKProviderAdapter} from './src/llm/providers/ai-sdk-provider.js'
import {providerRegistry} from './src/llm/registry/provider-registry.js'
import {resolveModel} from './src/llm/registry/model-registry.js'
import {ToolRegistry} from './src/tools/registry/tool-registry.js'

function createCliAgent(): GeneralAssistant {
    const modelId = resolveModel('general')
    const model = providerRegistry.languageModel(modelId as any)
    const agent = new GeneralAssistant(
        new AISDKProviderAdapter(model),
        new ToolRegistry(),
    )

    agent.config = {...agent.config, modelId}
    return agent
}

async function runPrompt(agent: GeneralAssistant, prompt: string): Promise<void> {
    let wroteText = false

    for await (const event of agent.run(prompt)) {
        if (event.type === 'text-delta') {
            output.write(event.text ?? '')
            wroteText = true
        } else if (event.type === 'tool-call' && event.toolCall) {
            output.write(`\n[tool] ${event.toolCall.name} ${JSON.stringify(event.toolCall.input)}\n`)
        } else if (event.type === 'tool-result' && event.toolResult) {
            output.write(`[result] ${JSON.stringify(event.toolResult.result)}\n`)
        } else if (event.type === 'error') {
            throw event.error ?? new Error('Agent execution failed')
        }
    }

    if (wroteText) output.write('\n')
}

async function main(): Promise<void> {
    const agent = createCliAgent()
    const inlinePrompt = process.argv.slice(2).join(' ').trim()

    if (inlinePrompt) {
        await runPrompt(agent, inlinePrompt)
        return
    }

    const readline = createInterface({input, output})
    console.log('Study Agent CLI，输入 /exit 退出。')

    try {
        while (true) {
            const prompt = (await readline.question('你> ')).trim()
            if (!prompt) continue
            if (prompt === '/exit' || prompt === '/quit') break

            try {
                await runPrompt(agent, prompt)
            } catch (error) {
                console.error('[cli]', error instanceof Error ? error.message : error)
            }
        }
    } finally {
        readline.close()
    }
}

void main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
