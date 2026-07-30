export type ModelProfile =
    | "fast"
    | "general"
    | "reasoning"
    | "vision"
    | "fallback";

const modelProfiles: Record<ModelProfile, string> = {
    fast:
        process.env.LLM_MODEL_FAST ??
        "lmstudio:qwen-local",

    general:
        process.env.LLM_MODEL_GENERAL ??
        "lmstudio:qwen-local",

    reasoning:
        process.env.LLM_MODEL_REASONING ??
        "openai:reasoning-model",

    vision:
        process.env.LLM_MODEL_VISION ??
        "openai:vision-model",

    fallback:
        process.env.LLM_MODEL_FALLBACK ??
        "anthropic:general-model",
};

export function resolveModel(
    profile: ModelProfile,
): string {
    const model = modelProfiles[profile];

    if (!model) {
        throw new Error(
            `Model profile not configured: ${profile}`,
        );
    }

    return model;
}
