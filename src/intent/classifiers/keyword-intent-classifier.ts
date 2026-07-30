import type {
    BuiltinAgentKey,
    IntentClassificationContext,
    IntentClassifier,
    IntentClassifierSignal,
} from '../domain/intent.js'

interface IntentRule {
    agentKey: BuiltinAgentKey
    score: number
    reason: string
    patterns: readonly RegExp[]
}

const rules: readonly IntentRule[] = [
    {
        agentKey: 'math',
        score: 0.92,
        reason: 'matched arithmetic expression or calculation wording',
        patterns: [
            /(?:计算|算一下|等于多少|加减乘除|求和|相乘|相除|百分比)/i,
            /\d+(?:\.\d+)?\s*(?:\+|-|\*|×|\/|÷)\s*\d+(?:\.\d+)?/,
        ],
    },
    {
        agentKey: 'time',
        score: 0.9,
        reason: 'matched current time, date or timezone wording',
        patterns: [
            /(?:现在|当前|当地).{0,6}(?:几点|时间|日期)/i,
            /(?:时区|timezone|UTC|GMT|Asia\/|America\/)/i,
            /(?:今天|明天|昨天).{0,6}(?:几号|星期几|日期)/i,
        ],
    },
]

function normalizeScore(score: number): number {
    if (!Number.isFinite(score)) return 0
    return Math.max(0, Math.min(1, score))
}

export class KeywordIntentClassifier implements IntentClassifier {
    readonly name = 'keyword-rules'
    readonly weight = 1

    classify(
        input: string,
        _context?: IntentClassificationContext,
    ): readonly IntentClassifierSignal[] {
        const text = input.trim()
        if (!text) return []

        const signals: IntentClassifierSignal[] = []
        for (const rule of rules) {
            const matches = rule.patterns.filter((pattern) => pattern.test(text)).length
            if (matches === 0) continue

            signals.push({
                agentKey: rule.agentKey,
                score: normalizeScore(rule.score + Math.min(0.06, (matches - 1) * 0.03)),
                reason: rule.reason,
            })
        }

        return signals
    }
}
