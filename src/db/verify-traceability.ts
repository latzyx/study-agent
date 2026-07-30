import {eq} from 'drizzle-orm'
import {
    createAiTrace,
    finishAiTrace,
    getAiTrace,
} from '../services/ai-trace-service.js'
import {
    createUserAgent,
    listAgentVersions,
    rollbackUserAgent,
    updateUserAgent,
} from '../services/agent-service.js'
import {closeDatabaseConnection, db} from './index.js'
import {aiRuns, conversations, users} from './schema.js'

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
}

async function verifyTraceability(): Promise<void> {
    const suffix = crypto.randomUUID()
    const [user] = await db.insert(users).values({
        username: `trace-${suffix}`.slice(0, 50),
        email: `trace-${suffix}@example.test`,
        passwordHash: 'integration-test-only',
    }).returning()
    assert(user, 'Failed to create integration user')

    let traceId: string | undefined

    try {
        const v1 = await createUserAgent({
            userId: user.id,
            requestId: 'integration-create',
            name: 'Version One',
            description: 'initial',
            systemPrompt: 'You are version one.',
            modelProfile: 'general',
            maxSteps: 3,
            tools: ['calculator'],
        })
        assert(v1.version === 1, 'Created agent must start at version 1')

        const v2Result = await updateUserAgent({
            userId: user.id,
            requestId: 'integration-update',
            agentId: v1.id,
            name: 'Version Two',
            maxSteps: 6,
        })
        assert(v2Result.agent.version === 2, 'Updated agent must advance to version 2')
        assert(v2Result.agent.name === 'Version Two', 'Agent update was not persisted')

        const rollback = await rollbackUserAgent({
            userId: user.id,
            requestId: 'integration-rollback',
            agentId: v1.id,
            targetVersion: 1,
        })
        assert(rollback.agent.version === 3, 'Rollback must create a new version')
        assert(rollback.agent.name === 'Version One', 'Rollback did not restore the old snapshot')
        assert(rollback.agent.maxSteps === 3, 'Rollback did not restore maxSteps')
        assert(rollback.restoredFromVersion === 1, 'Rollback source version is incorrect')

        const versions = await listAgentVersions({
            userId: user.id,
            agentId: v1.id,
            page: 1,
            pageSize: 10,
        })
        assert(versions.total === 3, 'Expected create, update and rollback versions')
        assert(
            versions.items.map((item) => item.version).join(',') === '3,2,1',
            'Agent versions are not ordered newest first',
        )
        assert(versions.items[0]?.changeType === 'rollback', 'Latest version must record rollback')
        assert(versions.items[0]?.sourceVersion === 1, 'Rollback version must reference source version')

        const [conversation] = await db.insert(conversations).values({
            userId: user.id,
            agentId: v1.id,
            sessionId: `integration-${suffix}`,
        }).returning()
        assert(conversation, 'Failed to create integration conversation')

        const trace = await createAiTrace({
            requestId: 'integration-trace',
            userId: user.id,
            agentId: v1.id,
            conversationId: conversation.id,
            sessionId: conversation.sessionId,
            functionId: 'integration.traceability',
            input: {
                prompt: 'hello',
                authorization: 'Bearer must-be-redacted',
            },
            metadata: {suite: 'database'},
        })
        traceId = trace.traceId

        const telemetry = trace.telemetryForStep(1, 'test-provider:test-model')
        assert(telemetry, 'Telemetry settings must be created when tracing is enabled')
        await telemetry.onStart?.({
            model: {provider: 'test-provider', modelId: 'test-model'},
            messages: [{role: 'user', content: 'hello'}],
        })
        await telemetry.onStepStart?.({
            stepNumber: 0,
            model: {provider: 'test-provider', modelId: 'test-model'},
            messages: [{role: 'user', content: 'hello'}],
        })

        const toolCall = {
            id: 'integration-tool-call',
            name: 'calculator',
            input: {a: 1, b: 2, op: 'add'},
        }
        trace.toolStarted(1, toolCall)
        trace.toolFinished(1, toolCall, {success: true, result: 3}, 4)

        await telemetry.onStepFinish?.({
            stepNumber: 0,
            model: {provider: 'test-provider', modelId: 'test-model'},
            finishReason: 'stop',
            text: 'done',
            usage: {inputTokens: 5, outputTokens: 2, totalTokens: 7},
        })
        await telemetry.onFinish?.({
            model: {provider: 'test-provider', modelId: 'test-model'},
            finishReason: 'stop',
            text: 'done',
            totalUsage: {inputTokens: 5, outputTokens: 2, totalTokens: 7},
        })

        await finishAiTrace(trace, {
            status: 'success',
            output: {reply: 'done'},
            usage: {inputTokens: 5, outputTokens: 2, totalTokens: 7},
            stepCount: 1,
            toolCallCount: 1,
        })

        const persisted = await getAiTrace(user.id, trace.traceId)
        assert(persisted.run.status === 'success', 'Trace run did not finish successfully')
        assert(persisted.run.totalTokens === 7, 'Trace token usage was not persisted')
        assert(persisted.run.stepCount === 1, 'Trace step count was not persisted')
        assert(persisted.run.toolCallCount === 1, 'Trace tool count was not persisted')
        assert(
            persisted.spans.some((span) => span.kind === 'generation' && span.status === 'success'),
            'Generation span was not persisted',
        )
        assert(
            persisted.spans.some((span) => span.kind === 'step' && span.status === 'success'),
            'Step span was not persisted',
        )
        assert(
            persisted.spans.some((span) => span.kind === 'tool' && span.status === 'success'),
            'Tool span was not persisted',
        )

        console.log('[db:verify:traceability] trace persistence and rollback verified')
    } finally {
        if (traceId) await db.delete(aiRuns).where(eq(aiRuns.traceId, traceId))
        await db.delete(users).where(eq(users.id, user.id))
    }
}

try {
    await verifyTraceability()
} finally {
    await closeDatabaseConnection()
}
