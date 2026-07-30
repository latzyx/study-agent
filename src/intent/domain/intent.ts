export type BuiltinAgentKey = 'general' | 'math' | 'time'

export interface IntentCandidate {
    agentKey: BuiltinAgentKey
    score: number
    reasons: string[]
    sources: string[]
}

export interface IntentClassificationContext {
    history?: readonly {role: string; content: string}[]
    requestedAgentKey?: BuiltinAgentKey
}

export interface IntentClassifierSignal {
    agentKey: BuiltinAgentKey
    score: number
    reason: string
}

export interface IntentClassifier {
    readonly name: string
    readonly weight?: number
    classify(
        input: string,
        context?: IntentClassificationContext,
    ): readonly IntentClassifierSignal[] | Promise<readonly IntentClassifierSignal[]>
}

export interface IntentDecision {
    selectedAgentKey: BuiltinAgentKey
    confidence: number
    ambiguous: boolean
    requiresClarification: boolean
    candidates: IntentCandidate[]
}
