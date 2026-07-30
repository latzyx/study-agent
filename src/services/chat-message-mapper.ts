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

    const seen = new Set<string>()
    return value.flatMap((item) => {
        if (!isRecord(item)) return []
        const id = typeof item.id === 'string' ? item.id.trim() : ''
        const name = typeof item.name === 'string' ? item.name.trim() : ''
        if (!id || !name || seen.has(id)) return []
        seen.add(id)
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

export function trimStoredHistoryToTurnBoundary(
    rows: readonly StoredChatMessage[],
): StoredChatMessage[] {
    const firstUserIndex = rows.findIndex((row) => row.role === 'user')
    return firstUserIndex < 0 ? [] : rows.slice(firstUserIndex)
}

export function restoreLLMMessages(rows: readonly StoredChatMessage[]): LLMMessage[] {
    const restored: LLMMessage[] = []
    const pendingToolCalls = new Map<string, string>()

    for (const row of trimStoredHistoryToTurnBoundary(rows)) {
        if (row.role === 'assistant') {
            pendingToolCalls.clear()
            const toolCalls = parseAssistantToolCalls(row.toolCalls)
            for (const toolCall of toolCalls) pendingToolCalls.set(toolCall.id, toolCall.name)
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
            if (pendingToolCalls.get(metadata.toolCallId) !== metadata.name) continue
            pendingToolCalls.delete(metadata.toolCallId)
            restored.push({
                role: 'tool',
                content: row.content,
                name: metadata.name,
                toolCallId: metadata.toolCallId,
            })
            continue
        }

        pendingToolCalls.clear()
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
    const normalizedUserMessage = userMessage.trim()
    if (!normalizedUserMessage) throw new Error('Cannot persist an empty user message')
    if (!assistantReply.trim() && toolCalls.length === 0) {
        throw new Error('Cannot persist a turn without an assistant response')
    }

    const rows: Array<{
        conversationId: string
        role: 'user' | 'assistant' | 'tool'
        content: string | null
        toolCalls: unknown
    }> = [{
        conversationId,
        role: 'user',
        content: normalizedUserMessage,
        toolCalls: null,
    }]

    rows.push({
        conversationId,
        role: 'assistant',
        content: assistantReply || null,
        toolCalls: toolCalls.length > 0
            ? toolCalls.map(({id, name, args}) => ({id, name, args}))
            : null,
    })

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
