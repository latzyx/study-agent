import {describe, expect, test} from 'bun:test'
import {IntentRouter} from '../src/intent/intent-router'
import type {IntentClassifier} from '../src/intent/domain/intent'

describe('IntentRouter', () => {
    test('routes arithmetic requests to the math agent', async () => {
        const decision = await new IntentRouter().route('请计算 123 * 456 等于多少')

        expect(decision.selectedAgentKey).toBe('math')
        expect(decision.confidence).toBeGreaterThanOrEqual(0.9)
        expect(decision.requiresClarification).toBe(false)
    })

    test('routes timezone requests to the time agent', async () => {
        const decision = await new IntentRouter().route('现在 America/New_York 是几点？')

        expect(decision.selectedAgentKey).toBe('time')
        expect(decision.candidates[0]?.agentKey).toBe('time')
    })

    test('falls back to general when no specialized intent is confident', async () => {
        const decision = await new IntentRouter().route('帮我写一段项目介绍')

        expect(decision.selectedAgentKey).toBe('general')
        expect(decision.confidence).toBe(0)
    })

    test('explicit agent selection is authoritative', async () => {
        const decision = await new IntentRouter().route('现在几点', {requestedAgentKey: 'general'})

        expect(decision.selectedAgentKey).toBe('general')
        expect(decision.confidence).toBe(1)
        expect(decision.candidates[0]?.sources).toEqual(['request'])
    })

    test('marks close classifier results as ambiguous', async () => {
        const classifier: IntentClassifier = {
            name: 'test-model',
            classify: () => [
                {agentKey: 'math', score: 0.8, reason: 'math score'},
                {agentKey: 'time', score: 0.75, reason: 'time score'},
            ],
        }
        const decision = await new IntentRouter({classifiers: [classifier]}).route('ambiguous')

        expect(decision.ambiguous).toBe(true)
        expect(decision.requiresClarification).toBe(true)
        expect(decision.selectedAgentKey).toBe('general')
    })

    test('rejects non-finite classifier scores', async () => {
        const classifier: IntentClassifier = {
            name: 'broken-model',
            classify: () => [{agentKey: 'math', score: Number.NaN, reason: 'broken'}],
        }

        await expect(new IntentRouter({classifiers: [classifier]}).route('test'))
            .rejects.toThrow('Intent classifier returned an invalid score: broken-model')
    })
})
