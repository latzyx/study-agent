import {Elysia, t} from 'elysia'
import {and, desc, eq, sql} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {agents} from '../../db/schema.js'
import {recordAuditLog} from '../../services/audit-log-service.js'
import {findUnknownBuiltinTools} from '../../tools/builtin/index.js'
import {createApiError} from '../errors/api-error.js'
import {
    authenticateAccessToken,
    authPlugin,
    unauthorizedResponse,
} from '../middleware/auth.js'
import {agentListQuery, createAgentBody, updateAgentBody} from '../schemas/agent.js'

function notFoundResponse(): Response {
    return Response.json(
        {success: false, error: {code: 'NOT_FOUND', message: 'Agent not found'}},
        {status: 404},
    )
}

function serializeAgent(agent: typeof agents.$inferSelect) {
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

export const agentRoutes = new Elysia({prefix: '/agents'})
    .use(authPlugin)
    .get(
        '/',
        async ({JWT, headers, query}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const offset = (page - 1) * pageSize
            const ownedByUser = eq(agents.createdBy, user.sub)

            const [countResult] = await db.select({count: sql<number>`count(*)::int`})
                .from(agents)
                .where(ownedByUser)
            const items = await db.select()
                .from(agents)
                .where(ownedByUser)
                .orderBy(desc(agents.createdAt))
                .limit(pageSize)
                .offset(offset)

            return {
                success: true,
                data: items.map(serializeAgent),
                pagination: {page, pageSize, total: countResult?.count ?? 0},
            }
        },
        {
            query: agentListQuery,
            detail: {summary: 'List current user agents', security: [{BearerAuth: []}]},
        },
    )
    .post(
        '/',
        async ({body, JWT, headers, request}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const tools = normalizeTools(body.tools)
            const [newAgent] = await db.insert(agents).values({
                name: body.name.trim(),
                description: body.description,
                systemPrompt: body.systemPrompt,
                modelProfile: body.modelProfile ?? 'general',
                maxSteps: body.maxSteps ?? 5,
                tools,
                createdBy: user.sub,
            }).returning()

            if (!newAgent) {
                throw createApiError(500, 'CREATE_FAILED', 'Failed to create agent')
            }

            await recordAuditLog({
                userId: user.sub,
                action: 'agent.create',
                resourceType: 'agent',
                resourceId: newAgent.id,
                details: {
                    name: newAgent.name,
                    modelProfile: newAgent.modelProfile,
                    tools: newAgent.tools,
                },
                request,
            })

            return {success: true, data: serializeAgent(newAgent)}
        },
        {
            body: createAgentBody,
            detail: {summary: 'Create a new agent', security: [{BearerAuth: []}]},
        },
    )
    .get(
        '/:id',
        async ({params, JWT, headers}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const [agent] = await db.select().from(agents).where(and(
                eq(agents.id, params.id),
                eq(agents.createdBy, user.sub),
            )).limit(1)

            if (!agent) return notFoundResponse()
            return {success: true, data: serializeAgent(agent)}
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            detail: {summary: 'Get agent by ID', security: [{BearerAuth: []}]},
        },
    )
    .put(
        '/:id',
        async ({params, body, JWT, headers, request}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const updateData: Partial<typeof agents.$inferInsert> = {updatedAt: new Date()}
            const changedFields: string[] = []

            if (body.name !== undefined) {
                updateData.name = body.name.trim()
                changedFields.push('name')
            }
            if (body.description !== undefined) {
                updateData.description = body.description
                changedFields.push('description')
            }
            if (body.systemPrompt !== undefined) {
                updateData.systemPrompt = body.systemPrompt
                changedFields.push('systemPrompt')
            }
            if (body.modelProfile !== undefined) {
                updateData.modelProfile = body.modelProfile
                changedFields.push('modelProfile')
            }
            if (body.maxSteps !== undefined) {
                updateData.maxSteps = body.maxSteps
                changedFields.push('maxSteps')
            }
            if (body.tools !== undefined) {
                updateData.tools = normalizeTools(body.tools)
                changedFields.push('tools')
            }

            if (changedFields.length === 0) {
                throw createApiError(400, 'NO_CHANGES', 'At least one field must be provided')
            }

            const [updated] = await db.update(agents)
                .set(updateData)
                .where(and(eq(agents.id, params.id), eq(agents.createdBy, user.sub)))
                .returning()

            if (!updated) return notFoundResponse()

            await recordAuditLog({
                userId: user.sub,
                action: 'agent.update',
                resourceType: 'agent',
                resourceId: updated.id,
                details: {changedFields},
                request,
            })

            return {success: true, data: serializeAgent(updated)}
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            body: updateAgentBody,
            detail: {summary: 'Update an agent', security: [{BearerAuth: []}]},
        },
    )
    .delete(
        '/:id',
        async ({params, JWT, headers, request}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const [deleted] = await db.delete(agents)
                .where(and(eq(agents.id, params.id), eq(agents.createdBy, user.sub)))
                .returning({id: agents.id, name: agents.name})

            if (!deleted) return notFoundResponse()

            await recordAuditLog({
                userId: user.sub,
                action: 'agent.delete',
                resourceType: 'agent',
                resourceId: deleted.id,
                details: {name: deleted.name},
                request,
            })

            return {success: true}
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            detail: {summary: 'Delete an agent', security: [{BearerAuth: []}]},
        },
    )
