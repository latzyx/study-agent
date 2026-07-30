import {describe, expect, test} from 'bun:test'
import {
    buildTurnMessageRows,
    restoreLLMMessages,
} from '../src/services/chat-message-mapper'

describe('chat message mapper', () => {
    test('persists a complete user, assistant and tool message chain', () => {
        const rows = buildTurnMessageRows('conversation-1', 'calculate', '', [{
            id: 'call-1',
            name: 'calculator',
            args: {a: 1, b: 2, op: 'add'},
            result: {result: 3},
        }])

        expect(rows.map((row) => row.role)).toEqual(['user', 'assistant', 'tool'])
        expect(rows[1]?.toolCalls).toEqual([{
            id: 'call-1',
            name: 'calculator',
            args: {a: 1, b: 2, op: 'add'},
        }])
        expect(rows[2]?.toolCalls).toEqual({toolCallId: 'call-1', name: 'calculator'})
    })

    test('restores tool calls as structured LLM messages', () => {
        const restored = restoreLLMMessages([
            {role: 'user', content: 'calculate', toolCalls: null},
            {
                role: 'assistant',
                content: null,
                toolCalls: [{id: 'call-1', name: 'calculator', args: {a: 1}}],
            },
            {
                role: 'tool',
                content: '{"result":3}',
                toolCalls: {toolCallId: 'call-1', name: 'calculator'},
            },
        ])

        expect(restored).toEqual([
            {role: 'user', content: 'calculate'},
            {
                role: 'assistant',
                content: '',
                toolCalls: [{id: 'call-1', name: 'calculator', input: {a: 1}}],
            },
            {
                role: 'tool',
                content: '{"result":3}',
                name: 'calculator',
                toolCallId: 'call-1',
            },
        ])
    })

    test('drops malformed stored tool messages instead of inventing ids', () => {
        expect(restoreLLMMessages([
            {role: 'tool', content: '{}', toolCalls: {name: 'calculator'}},
        ])).toEqual([])
    })
})