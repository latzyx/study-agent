import type {LLMMessage, LLMToolCall} from '../llm/domain/llm-provider.js'

export interface PersistedToolCall {
    id: string
    name: string
    args: unknown
    result: unknown
}

export interface StoredChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string | null
    toolCalls: unknown
}

interface StoredToolMetadata {
    toolCallId: string
    name: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function parseAssistantToolCalls(value: unknown): LLMToolCall[] {
    if (!Array.isArray(value)) return []

    return value.flatMap((item) => {
        if (!isRecord(item)) return []
        const id = typeof item.id === 'string' ? item.id.trim() : ''
        const name = typeof item.name === 'string' ? item.name.trim() : ''
        if (!id || !name) return []
        return [{id, name, input: item.args}]
    })
}

function parseToolMetadata(value: unknown): StoredToolMetadata | undefined {
    if (!isRecord(value)) return undefined
    const toolCallId = typeof value.toolCallId === 'string' ? value.toolCallId.trim() : ''
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    if (!toolCallId || !name) return undefined
    return {toolCallId, name}
}

export function restoreLLMMessages(rows: readonly StoredChatMessage[]): LLMMessage[] {
    const restored: LLMMessage[] = []

    for (const row of rows) {
        if (row.role === 'assistant') {
            const toolCalls = parseAssistantToolCalls(row.toolCalls)
            if (!row.content?.trim() && toolCalls.length === 0) continue
            restored.push({
                role: 'assistant',
                content: row.content ?? '',
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            })
            continue
        }

        if (row.role === 'tool') {
            const metadata = parseToolMetadata(row.toolCalls)
            if (!metadata || row.content === null) continue
            restored.push({
                role: 'tool',
                content: row.content,
                name: metadata.name,
                toolCallId: metadata.toolCallId,
            })
            continue
        }

        if (!row.content?.trim()) continue
        restored.push({role: row.role, content: row.content})
    }

    return restored
}

export function serializeToolResultForStorage(result: unknown): string {
    const seen = new WeakSet<object>()
    try {
        return JSON.stringify(result, (_key, value: unknown) => {
            if (typeof value === 'bigint') return value.toString()
            if (typeof value !== 'object' || value === null) return value
            if (seen.has(value)) return '[Circular]'
            seen.add(value)
            return value
        }) ?? 'null'
    } catch (error) {
        return JSON.stringify({
            error: 'TOOL_RESULT_SERIALIZATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
        })
    }
}

export function buildTurnMessageRows(
    conversationId: string,
    userMessage: string,
    assistantReply: string,
    toolCalls: readonly PersistedToolCall[],
) {
    const rows: Array<{
        conversationId: string
        role: 'user' | 'assistant' | 'tool'
        content: string | null
        toolCalls: unknown
    }> = [{
        conversationId,
        role: 'user',
        content: userMessage,
        toolCalls: null,
    }]

    if (assistantReply || toolCalls.length > 0) {
        rows.push({
            conversationId,
            role: 'assistant',
            content: assistantReply || null,
            toolCalls: toolCalls.length > 0
                ? toolCalls.map(({id, name, args}) => ({id, name, args}))
                : null,
        })
    }

    for (const toolCall of toolCalls) {
        rows.push({
            conversationId,
            role: 'tool',
            content: serializeToolResultForStorage(toolCall.result),
            toolCalls: {toolCallId: toolCall.id, name: toolCall.name},
        })
    }

    return rows
}