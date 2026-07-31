import {describe, expect, test} from 'bun:test'
import {
    buildTurnMessageRows,
    restoreLLMMessages,
    trimStoredHistoryToTurnBoundary,
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

    test('drops leading orphan tool rows when a history query cuts through a turn', () => {
        const rows = [
            {
                role: 'tool' as const,
                content: '{"old":true}',
                toolCalls: {toolCallId: 'old', name: 'calculator'},
            },
            {role: 'user' as const, content: 'new question', toolCalls: null},
            {role: 'assistant' as const, content: 'new answer', toolCalls: null},
        ]

        expect(trimStoredHistoryToTurnBoundary(rows)).toEqual(rows.slice(1))
        expect(restoreLLMMessages(rows)).toEqual([
            {role: 'user', content: 'new question'},
            {role: 'assistant', content: 'new answer', toolCalls: undefined},
        ])
    })

    test('drops mismatched and duplicate persisted tool calls', () => {
        expect(restoreLLMMessages([
            {role: 'user', content: 'calculate', toolCalls: null},
            {
                role: 'assistant',
                content: null,
                toolCalls: [
                    {id: 'call-1', name: 'calculator', args: {}},
                    {id: 'call-1', name: 'calculator', args: {duplicate: true}},
                ],
            },
            {
                role: 'tool',
                content: '{}',
                toolCalls: {toolCallId: 'call-1', name: 'current_time'},
            },
        ])).toEqual([
            {role: 'user', content: 'calculate'},
            {
                role: 'assistant',
                content: '',
                toolCalls: [{id: 'call-1', name: 'calculator', input: {}}],
            },
        ])
    })

    test('rejects persistence of an empty assistant response', () => {
        expect(() => buildTurnMessageRows('conversation-1', 'hello', '   ', []))
            .toThrow('Cannot persist a turn without an assistant response')
    })

    test('drops malformed stored tool messages instead of inventing ids', () => {
        expect(restoreLLMMessages([
            {role: 'tool', content: '{}', toolCalls: {name: 'calculator'}},
        ])).toEqual([])
    })
})
