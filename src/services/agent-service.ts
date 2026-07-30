import {and, desc, eq, sql} from 'drizzle-orm'
import type {ModelProfile} from '../agent/types/agent.js'
import {createApiError} from '../api/errors/api-error.js'
import {db} from '../db/index.js'
import {agents} from '../db/schema.js'
import {findUnknownBuiltinTools} from '../tools/builtin/index.js'

export interface AgentListInput {
    userId: string
    page: number
    pageSize: number
}

export interface CreateAgentInput {
    userId: string
    name: string
    description?: string
    systemPrompt?: string
    modelProfile?: ModelProfile
    maxSteps?: number
    tools?: readonly string[]
}

export interface UpdateAgentInput {
    userId: string
    agentId: string
    name?: string
    description?: string
    systemPrompt?: string
    modelProfile?: ModelProfile
    maxSteps?: number
    tools?: readonly string[]
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
    const [created] = await db.insert(agents).values({
        name: input.name.trim(),
        description: input.description,
        systemPrompt: input.systemPrompt,
        modelProfile: input.modelProfile ?? 'general',
        maxSteps: input.maxSteps ?? 5,
        tools: normalizeTools(input.tools),
        createdBy: input.userId,
    }).returning()

    if (!created) {
        throw createApiError(500, 'AGENT_CREATE_FAILED', 'Failed to create agent')
    }

    return created
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
    const updateData: Partial<typeof agents.$inferInsert> = {updatedAt: new Date()}
    const changedFields: string[] = []

    if (input.name !== undefined) {
        updateData.name = input.name.trim()
        changedFields.push('name')
    }
    if (input.description !== undefined) {
        updateData.description = input.description
        changedFields.push('description')
    }
    if (input.systemPrompt !== undefined) {
        updateData.systemPrompt = input.systemPrompt
        changedFields.push('systemPrompt')
    }
    if (input.modelProfile !== undefined) {
        updateData.modelProfile = input.modelProfile
        changedFields.push('modelProfile')
    }
    if (input.maxSteps !== undefined) {
        updateData.maxSteps = input.maxSteps
        changedFields.push('maxSteps')
    }
    if (input.tools !== undefined) {
        updateData.tools = normalizeTools(input.tools)
        changedFields.push('tools')
    }

    if (changedFields.length === 0) {
        throw createApiError(400, 'NO_CHANGES', 'At least one field must be provided')
    }

    const [updated] = await db.update(agents)
        .set(updateData)
        .where(and(
            eq(agents.id, input.agentId),
            eq(agents.createdBy, input.userId),
        ))
        .returning()

    if (!updated) agentNotFound()
    return {agent: updated, changedFields}
}

export async function deleteUserAgent(userId: string, agentId: string) {
    const [deleted] = await db.delete(agents)
        .where(and(eq(agents.id, agentId), eq(agents.createdBy, userId)))
        .returning({id: agents.id, name: agents.name})

    if (!deleted) agentNotFound()
    return deleted
}
