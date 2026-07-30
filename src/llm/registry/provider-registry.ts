import {createProviderRegistry, type LanguageModel} from 'ai'
import {createOpenAI} from '@ai-sdk/openai'
import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAICompatible} from '@ai-sdk/openai-compatible'
import {env} from '../../config/env.js'

const openai = createOpenAI({
    apiKey: env.providers.openaiApiKey,
})

const anthropic = createAnthropic({
    apiKey: env.providers.anthropicApiKey,
})

const lmstudio = createOpenAICompatible({
    name: 'lmstudio',
    baseURL: env.providers.lmStudioBaseUrl,
    apiKey: env.providers.lmStudioApiKey,
})

const vllm = createOpenAICompatible({
    name: 'vllm',
    baseURL: env.providers.vllmBaseUrl,
    apiKey: env.providers.vllmApiKey,
})

export const providerRegistry = createProviderRegistry({
    openai,
    anthropic,
    lmstudio,
    vllm,
})

export function resolveLanguageModel(modelId: string): LanguageModel {
    const normalizedModelId = modelId.trim()
    if (!normalizedModelId) {
        throw new Error('LLM model id cannot be empty')
    }

    return providerRegistry.languageModel(normalizedModelId as Parameters<typeof providerRegistry.languageModel>[0])
}
