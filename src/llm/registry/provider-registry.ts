import {createProviderRegistry} from "ai";
import {createOpenAI} from "@ai-sdk/openai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {createOpenAICompatible} from "@ai-sdk/openai-compatible";

const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

const lmstudio = createOpenAICompatible({
    name: "lmstudio",
    baseURL:
        process.env.LM_STUDIO_BASE_URL ??
        "http://127.0.0.1:1234/v1",
    apiKey:
        process.env.LM_STUDIO_API_KEY ??
        "lm-studio",
});

const vllm = createOpenAICompatible({
    name: "vllm",
    baseURL:
        process.env.VLLM_BASE_URL ??
        "http://127.0.0.1:8000/v1",
    apiKey:
        process.env.VLLM_API_KEY ??
        "local-vllm",
});

export const providerRegistry =
    createProviderRegistry({
        openai,
        anthropic,
        lmstudio,
        vllm,
    });
