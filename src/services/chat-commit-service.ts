import {and, eq} from 'drizzle-orm'
import {createApiError} from '../api/errors/api-error.js'
import {db} from '../db/index.js'
import {chatRequests, messages} from '../db/schema.js'
import type {IdempotentChatResult} from './chat-idempotency-service.js'

export async function commitSuccessfulChat(input: {
    requestRecordId?: string
    conversationId: string
    inputMessage: string
    result: IdempotentChatResult
    toolCalls: Array<{
        id: string
        name: string
        args: unknown
        result: unknown
    }>
}): Promise<void> {
    const userCreatedAt = new Date()
    const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1)

    await db.transaction(async (tx) => {
        await tx.insert(messages).values({
            conversationId: input.conversationId,
            role: 'user',
            content: input.inputMessage,
            createdAt: userCreatedAt,
        })
        await tx.insert(messages).values({
            conversationId: input.conversationId,
            role: 'assistant',
            content: input.result.reply || null,
            toolCalls: input.toolCalls.length > 0 ? input.toolCalls : null,
            createdAt: assistantCreatedAt,
        })

        if (!input.requestRecordId) return
        const [completed] = await tx.update(chatRequests).set({
            status: 'success',
            result: input.result as unknown as Record<string, unknown>,
            traceId: input.result.traceId,
            finishedAt: new Date(),
            updatedAt: new Date(),
            errorCode: null,
            errorMessage: null,
        }).where(and(
            eq(chatRequests.id, input.requestRecordId),
            eq(chatRequests.status, 'running'),
        )).returning({id: chatRequests.id})

        if (!completed) {
            throw createApiError(
                409,
                'IDEMPOTENCY_STATE_CHANGED',
                'Idempotent request state changed before the response could be committed',
            )
        }
    })
}
