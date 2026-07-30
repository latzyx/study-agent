import {env} from '../../config/env.js'

export type ModelProfile = 'fast' | 'general' | 'reasoning' | 'vision' | 'fallback'

const modelProfiles: Readonly<Record<ModelProfile, string>> = env.models

export function resolveModel(profile: ModelProfile): string {
    const model = modelProfiles[profile]
    if (!model) throw new Error(`Model profile not configured: ${profile}`)
    return model
}

export function listModelProfiles(): Readonly<Record<ModelProfile, string>> {
    return modelProfiles
}
