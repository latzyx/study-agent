import {and, desc, eq, sql} from 'drizzle-orm'
import type {ModelProfile} from '../agent/types/agent.js'
import {createApiError} from '../api/errors/api-error.js'
import {db} from '../db/index.js'
import {agents, agentVersions} from '../db/schema.js'
import {findUnknownBuiltinTools} from '../tools/builtin/index.js'

export interface AgentListInput {
    userId: string
    page: number
    pageSize: number
}

export interface CreateAgentInput {
    userId: string
    requestId?: string
    name: string
    description?: string
    systemPrompt?: string
    modelProfile?: ModelProfile
    maxSteps?: number
    tools?: readonly string[]
}

export interface UpdateAgentInput {
    userId: string
    requestId?: string
    agentId: string
    name?: string
    description?: string
    systemPrompt?: string
    modelProfile?: ModelProfile
    maxSteps?: number
    tools?: readonly string[]
}

interface AgentSnapshot extends Record<string, unknown> {
    name: string
    description: string | null
    systemPrompt: string | null
    modelProfile: ModelProfile
    maxSteps: number
    tools: string[]
}

export function serializeAgent(agent: typeof agents.$inferSelect) {
    return {
        ...agent,
        description: agent.description ?? undefined,
        systemPrompt: agent.systemPrompt ?? undefined,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
    }
}

function normalizeTools(toolNames: readonly string[] | undefined): string[] {
    const normalized = [...new Set(toolNames ?? [])]
    const unknown = findUnknownBuiltinTools(normalized)

    if (unknown.length > 0) {
        throw createApiError(
            400,
            'UNKNOWN_AGENT_TOOLS',
            `Unknown tools: ${unknown.join(', ')}`,
            {unknownTools: unknown},
        )
    }

    return normalized
}

function agentNotFound(): never {
    throw createApiError(404, 'AGENT_NOT_FOUND', 'Agent not found')
}

function versionConflict(): never {
    throw createApiError(
        409,
        'AGENT_VERSION_CONFLICT',
        'Agent was modified concurrently; reload it and retry',
    )
}

function snapshotAgent(agent: typeof agents.$inferSelect): AgentSnapshot {
    return {
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        modelProfile: agent.modelProfile,
        maxSteps: agent.maxSteps,
        tools: [...agent.tools],
    }
}

function parseSnapshot(value: unknown): AgentSnapshot {
    if (!value || typeof value !== 'object') {
        throw createApiError(500, 'INVALID_AGENT_VERSION', 'Stored agent version is invalid')
    }
    const snapshot = value as Record<string, unknown>
    const modelProfile = snapshot.modelProfile
    if (
        typeof snapshot.name !== 'string'
        || (snapshot.description !== null && typeof snapshot.description !== 'string')
        || (snapshot.systemPrompt !== null && typeof snapshot.systemPrompt !== 'string')
        || !['fast', 'general', 'reasoning', 'vision'].includes(String(modelProfile))
        || typeof snapshot.maxSteps !== 'number'
        || !Number.isInteger(snapshot.maxSteps)
        || !Array.isArray(snapshot.tools)
        || snapshot.tools.some((tool) => typeof tool !== 'string')
    ) {
        throw createApiError(500, 'INVALID_AGENT_VERSION', 'Stored agent version is invalid')
    }

    return {
        name: snapshot.name,
        description: snapshot.description as string | null,
        systemPrompt: snapshot.systemPrompt as string | null,
        modelProfile: modelProfile as ModelProfile,
        maxSteps: snapshot.maxSteps,
        tools: normalizeTools(snapshot.tools as string[]),
    }
}

export async function listUserAgents(input: AgentListInput) {
    const offset = (input.page - 1) * input.pageSize
    const ownedByUser = eq(agents.createdBy, input.userId)

    const [countResult, items] = await Promise.all([
        db.select({count: sql<number>`count(*)::int`})
            .from(agents)
            .where(ownedByUser)
            .then((rows) => rows[0]),
        db.select()
            .from(agents)
            .where(ownedByUser)
            .orderBy(desc(agents.createdAt))
            .limit(input.pageSize)
            .offset(offset),
    ])

    return {
        items,
        total: countResult?.count ?? 0,
    }
}

export async function createUserAgent(input: CreateAgentInput) {
    return db.transaction(async (tx) => {
        const [created] = await tx.insert(agents).values({
            name: input.name.trim(),
            description: input.description,
            systemPrompt: input.systemPrompt,
            modelProfile: input.modelProfile ?? 'general',
            maxSteps: input.maxSteps ?? 5,
            tools: normalizeTools(input.tools),
            version: 1,
            createdBy: input.userId,
        }).returning()

        if (!created) {
            throw createApiError(500, 'AGENT_CREATE_FAILED', 'Failed to create agent')
        }

        await tx.insert(agentVersions).values({
            agentId: created.id,
            version: created.version,
            snapshot: snapshotAgent(created),
            changeType: 'create',
            changedBy: input.userId,
            requestId: input.requestId,
        })

        return created
    })
}

export async function findUserAgent(userId: string, agentId: string) {
    const [agent] = await db.select().from(agents).where(and(
        eq(agents.id, agentId),
        eq(agents.createdBy, userId),
    )).limit(1)

    if (!agent) agentNotFound()
    return agent
}

export async function updateUserAgent(input: UpdateAgentInput) {
    const changedFields: string[] = []
    const requestedData: Partial<typeof agents.$inferInsert> = {}

    if (input.name !== undefined) {
        requestedData.name = input.name.trim()
        changedFields.push('name')
    }
    if (input.description !== undefined) {
        requestedData.description = input.description
        changedFields.push('description')
    }
    if (input.systemPrompt !== undefined) {
        requestedData.systemPrompt = input.systemPrompt
        changedFields.push('systemPrompt')
    }
    if (input.modelProfile !== undefined) {
        requestedData.modelProfile = input.modelProfile
        changedFields.push('modelProfile')
    }
    if (input.maxSteps !== undefined) {
        requestedData.maxSteps = input.maxSteps
        changedFields.push('maxSteps')
    }
    if (input.tools !== undefined) {
        requestedData.tools = normalizeTools(input.tools)
        changedFields.push('tools')
    }

    if (changedFields.length === 0) {
        throw createApiError(400, 'NO_CHANGES', 'At least one field must be provided')
    }

    return db.transaction(async (tx) => {
        const [current] = await tx.select().from(agents).where(and(
            eq(agents.id, input.agentId),
            eq(agents.createdBy, input.userId),
        )).limit(1)
        if (!current) agentNotFound()

        const nextVersion = current.version + 1
        const [updated] = await tx.update(agents)
            .set({
                ...requestedData,
                version: nextVersion,
                updatedAt: new Date(),
            })
            .where(and(
                eq(agents.id, input.agentId),
                eq(agents.createdBy, input.userId),
                eq(agents.version, current.version),
            ))
            .returning()

        if (!updated) versionConflict()

        await tx.insert(agentVersions).values({
            agentId: updated.id,
            version: updated.version,
            snapshot: snapshotAgent(updated),
            changeType: 'update',
            changedBy: input.userId,
            requestId: input.requestId,
        })

        return {agent: updated, changedFields}
    })
}

export async function listAgentVersions(input: AgentListInput & {agentId: string}) {
    await findUserAgent(input.userId, input.agentId)
    const offset = (input.page - 1) * input.pageSize
    const belongsToAgent = eq(agentVersions.agentId, input.agentId)

    const [countResult, items] = await Promise.all([
        db.select({count: sql<number>`count(*)::int`})
            .from(agentVersions)
            .where(belongsToAgent)
            .then((rows) => rows[0]),
        db.select()
            .from(agentVersions)
            .where(belongsToAgent)
            .orderBy(desc(agentVersions.version))
            .limit(input.pageSize)
            .offset(offset),
    ])

    return {
        items: items.map((item) => ({
            id: item.id,
            version: item.version,
            snapshot: item.snapshot,
            changeType: item.changeType,
            sourceVersion: item.sourceVersion ?? undefined,
            requestId: item.requestId ?? undefined,
            createdAt: item.createdAt.toISOString(),
        })),
        total: countResult?.count ?? 0,
    }
}

export async function rollbackUserAgent(input: {
    userId: string
    requestId?: string
    agentId: string
    targetVersion: number
}) {
    return db.transaction(async (tx) => {
        const [current] = await tx.select().from(agents).where(and(
            eq(agents.id, input.agentId),
            eq(agents.createdBy, input.userId),
        )).limit(1)
        if (!current) agentNotFound()

        if (input.targetVersion >= current.version) {
            throw createApiError(
                400,
                'INVALID_ROLLBACK_VERSION',
                'Rollback target must be older than the current version',
            )
        }

        const [target] = await tx.select().from(agentVersions).where(and(
            eq(agentVersions.agentId, input.agentId),
            eq(agentVersions.version, input.targetVersion),
        )).limit(1)
        if (!target) {
            throw createApiError(404, 'AGENT_VERSION_NOT_FOUND', 'Agent version not found')
        }

        const snapshot = parseSnapshot(target.snapshot)
        const nextVersion = current.version + 1
        const [updated] = await tx.update(agents).set({
            ...snapshot,
            version: nextVersion,
            updatedAt: new Date(),
        }).where(and(
            eq(agents.id, input.agentId),
            eq(agents.createdBy, input.userId),
            eq(agents.version, current.version),
        )).returning()

        if (!updated) versionConflict()

        await tx.insert(agentVersions).values({
            agentId: updated.id,
            version: updated.version,
            snapshot: snapshotAgent(updated),
            changeType: 'rollback',
            sourceVersion: input.targetVersion,
            changedBy: input.userId,
            requestId: input.requestId,
        })

        return {
            agent: updated,
            rolledBackFromVersion: current.version,
            restoredFromVersion: input.targetVersion,
        }
    })
}

export async function deleteUserAgent(userId: string, agentId: string) {
    const [deleted] = await db.delete(agents)
        .where(and(eq(agents.id, agentId), eq(agents.createdBy, userId)))
        .returning({id: agents.id, name: agents.name, version: agents.version})

    if (!deleted) agentNotFound()
    return deleted
}
