import {Elysia, t} from 'elysia'
import {and, desc, eq, sql} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {agents} from '../../db/schema.js'
import {createAgentBody, updateAgentBody, agentListQuery} from '../schemas/agent.js'
import {
    authenticateAccessToken,
    authPlugin,
    unauthorizedResponse,
} from '../middleware/auth.js'

function notFoundResponse(): Response {
    return Response.json(
        {success: false, error: {code: 'NOT_FOUND', message: 'Agent not found'}},
        {status: 404},
    )
}

function serializeAgent(agent: typeof agents.$inferSelect) {
    return {
        ...agent,
        tools: agent.tools ?? [],
        description: agent.description ?? undefined,
        systemPrompt: agent.systemPrompt ?? undefined,
        createdBy: agent.createdBy ?? undefined,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
    }
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
        async ({body, JWT, headers}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const [newAgent] = await db.insert(agents).values({
                name: body.name,
                description: body.description,
                systemPrompt: body.systemPrompt,
                modelProfile: body.modelProfile ?? 'general',
                maxSteps: body.maxSteps ?? 5,
                tools: body.tools ?? [],
                createdBy: user.sub,
            }).returning()

            if (!newAgent) {
                return Response.json(
                    {success: false, error: {code: 'CREATE_FAILED', message: 'Failed to create agent'}},
                    {status: 500},
                )
            }

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
        async ({params, body, JWT, headers}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const updateData: Partial<typeof agents.$inferInsert> = {updatedAt: new Date()}
            if (body.name !== undefined) updateData.name = body.name
            if (body.description !== undefined) updateData.description = body.description
            if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt
            if (body.modelProfile !== undefined) updateData.modelProfile = body.modelProfile
            if (body.maxSteps !== undefined) updateData.maxSteps = body.maxSteps
            if (body.tools !== undefined) updateData.tools = body.tools

            const [updated] = await db.update(agents)
                .set(updateData)
                .where(and(eq(agents.id, params.id), eq(agents.createdBy, user.sub)))
                .returning()

            if (!updated) return notFoundResponse()
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
        async ({params, JWT, headers}) => {
            const user = await authenticateAccessToken(JWT, headers.authorization)
            if (!user) return unauthorizedResponse()

            const [deleted] = await db.delete(agents)
                .where(and(eq(agents.id, params.id), eq(agents.createdBy, user.sub)))
                .returning({id: agents.id})

            if (!deleted) return notFoundResponse()
            return {success: true}
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            detail: {summary: 'Delete an agent', security: [{BearerAuth: []}]},
        },
    )
