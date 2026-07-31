import {KeywordIntentClassifier} from './classifiers/keyword-intent-classifier.js'
import type {
    BuiltinAgentKey,
    IntentCandidate,
    IntentClassificationContext,
    IntentClassifier,
    IntentDecision,
} from './domain/intent.js'

export interface IntentRouterOptions {
    classifiers?: readonly IntentClassifier[]
    fallbackAgentKey?: BuiltinAgentKey
    minimumConfidence?: number
    ambiguityMargin?: number
}

interface Aggregate {
    weightedScore: number
    totalWeight: number
    reasons: Set<string>
    sources: Set<string>
}

const agentKeys = new Set<BuiltinAgentKey>(['general', 'math', 'time'])

function clamp(value: number): number {
    return Math.max(0, Math.min(1, value))
}

export class IntentRouter {
    private readonly classifiers: readonly IntentClassifier[]
    private readonly fallbackAgentKey: BuiltinAgentKey
    private readonly minimumConfidence: number
    private readonly ambiguityMargin: number

    constructor(options: IntentRouterOptions = {}) {
        this.classifiers = options.classifiers ?? [new KeywordIntentClassifier()]
        this.fallbackAgentKey = options.fallbackAgentKey ?? 'general'
        this.minimumConfidence = options.minimumConfidence ?? 0.58
        this.ambiguityMargin = options.ambiguityMargin ?? 0.12

        if (this.classifiers.length === 0) throw new Error('IntentRouter requires at least one classifier')
        if (this.minimumConfidence < 0 || this.minimumConfidence > 1) {
            throw new Error('minimumConfidence must be between 0 and 1')
        }
        if (this.ambiguityMargin < 0 || this.ambiguityMargin > 1) {
            throw new Error('ambiguityMargin must be between 0 and 1')
        }
    }

    async route(input: string, context: IntentClassificationContext = {}): Promise<IntentDecision> {
        const normalizedInput = input.trim()
        if (!normalizedInput) throw new Error('Intent input cannot be empty')

        if (context.requestedAgentKey) {
            return {
                selectedAgentKey: context.requestedAgentKey,
                confidence: 1,
                ambiguous: false,
                requiresClarification: false,
                candidates: [{
                    agentKey: context.requestedAgentKey,
                    score: 1,
                    reasons: ['explicit agent selection'],
                    sources: ['request'],
                }],
            }
        }

        const aggregates = new Map<BuiltinAgentKey, Aggregate>()
        await Promise.all(this.classifiers.map(async (classifier) => {
            const weight = classifier.weight ?? 1
            if (!Number.isFinite(weight) || weight <= 0) {
                throw new Error(`Intent classifier weight must be positive: ${classifier.name}`)
            }

            const signals = await classifier.classify(normalizedInput, context)
            for (const signal of signals) {
                if (!agentKeys.has(signal.agentKey)) {
                    throw new Error(`Intent classifier returned an unknown agent: ${signal.agentKey}`)
                }
                if (!Number.isFinite(signal.score)) {
                    throw new Error(`Intent classifier returned an invalid score: ${classifier.name}`)
                }

                const aggregate = aggregates.get(signal.agentKey) ?? {
                    weightedScore: 0,
                    totalWeight: 0,
                    reasons: new Set<string>(),
                    sources: new Set<string>(),
                }
                aggregate.weightedScore += clamp(signal.score) * weight
                aggregate.totalWeight += weight
                aggregate.reasons.add(signal.reason)
                aggregate.sources.add(classifier.name)
                aggregates.set(signal.agentKey, aggregate)
            }
        }))

        const candidates: IntentCandidate[] = [...aggregates.entries()]
            .map(([agentKey, aggregate]) => ({
                agentKey,
                score: aggregate.totalWeight > 0
                    ? clamp(aggregate.weightedScore / aggregate.totalWeight)
                    : 0,
                reasons: [...aggregate.reasons],
                sources: [...aggregate.sources],
            }))
            .sort((left, right) => right.score - left.score || left.agentKey.localeCompare(right.agentKey))

        const top = candidates[0]
        if (!top || top.score < this.minimumConfidence) {
            return {
                selectedAgentKey: this.fallbackAgentKey,
                confidence: top?.score ?? 0,
                ambiguous: false,
                requiresClarification: false,
                candidates,
            }
        }

        const second = candidates[1]
        const ambiguous = Boolean(second && top.score - second.score < this.ambiguityMargin)
        return {
            selectedAgentKey: ambiguous ? this.fallbackAgentKey : top.agentKey,
            confidence: top.score,
            ambiguous,
            requiresClarification: ambiguous,
            candidates,
        }
    }
}

export const defaultIntentRouter = new IntentRouter()
