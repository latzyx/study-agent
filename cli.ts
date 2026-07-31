import {createInterface} from 'node:readline/promises'
import {stdin as input, stdout as output} from 'node:process'
import {createBuiltinAgentRuntime} from './src/agent/runtime/builtin-agent-runtime.js'
import {defaultIntentRouter} from './src/intent/index.js'

async function runPrompt(prompt: string): Promise<void> {
    const decision = await defaultIntentRouter.route(prompt)
    if (decision.requiresClarification) {
        const candidates = decision.candidates
            .slice(0, 2)
            .map((candidate) => candidate.agentKey)
            .join(' / ')
        throw new Error(`意图不明确，请补充问题范围。候选 Agent：${candidates}`)
    }

    const runtime = createBuiltinAgentRuntime(decision.selectedAgentKey)
    let wroteText = false

    for await (const event of runtime.agent.run(prompt)) {
        if (event.type === 'text-delta') {
            output.write(event.text ?? '')
            wroteText = true
        } else if (event.type === 'tool-call' && event.toolCall) {
            output.write(`\n[tool:${runtime.agentKey}] ${event.toolCall.name} ${JSON.stringify(event.toolCall.input)}\n`)
        } else if (event.type === 'tool-result' && event.toolResult) {
            output.write(`[result] ${JSON.stringify(event.toolResult.result)}\n`)
        } else if (event.type === 'error') {
            throw event.error ?? new Error('Agent execution failed')
        }
    }

    if (wroteText) output.write('\n')
}

async function main(): Promise<void> {
    const inlinePrompt = process.argv.slice(2).join(' ').trim()

    if (inlinePrompt) {
        await runPrompt(inlinePrompt)
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
                await runPrompt(prompt)
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
