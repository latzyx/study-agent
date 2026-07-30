import {Elysia, t} from 'elysia'
import {eq, desc, sql} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {agents} from '../../db/schema.js'
import {createAgentBody, updateAgentBody, agentResponse, agentListQuery} from '../schemas/agent.js'
import {authPlugin} from '../middleware/auth.js'

async function requireUser(JWT: any, auth: any) {
    if (!auth?.value) throw new Error('Unauthorized')
    const payload = await JWT.verify(auth.value)
    if (!payload) throw new Error('Unauthorized')
    return payload as {sub: string; username: string}
}

export const agentRoutes = new Elysia({prefix: '/agents'})
    .use(authPlugin)
    .get(
        '/',
        async ({JWT, cookie: {auth}, query}) => {
            const user = await requireUser(JWT, auth)
            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const offset = (page - 1) * pageSize

            const [countResult] = await db.select({count: sql<number>`count(*)::int`}).from(agents)
            const items = await db.select().from(agents).orderBy(desc(agents.createdAt)).limit(pageSize).offset(offset)

            return {
                success: true,
                data: items.map((a) => ({
                    ...a,
                    tools: (a.tools as string[]) ?? [],
                    createdAt: a.createdAt.toISOString(),
                    updatedAt: a.updatedAt.toISOString(),
                    createdBy: a.createdBy ?? undefined,
                })),
                pagination: {page, pageSize, total: countResult?.count ?? 0},
            }
        },
        {
            query: agentListQuery,
            detail: {summary: 'List all agents', security: [{BearerAuth: []}]},
        },
    )
    .post(
        '/',
        async ({body, JWT, cookie: {auth}}) => {
            const user = await requireUser(JWT, auth)

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
                return new Response(
                    JSON.stringify({success: false, error: {code: 'CREATE_FAILED', message: 'Failed to create agent'}}),
                    {status: 500, headers: {'Content-Type': 'application/json'}},
                )
            }

            return {
                success: true,
                data: {
                    ...newAgent,
                    tools: (newAgent.tools as string[]) ?? [],
                    createdAt: newAgent.createdAt.toISOString(),
                    updatedAt: newAgent.updatedAt.toISOString(),
                    createdBy: newAgent.createdBy ?? undefined,
                },
            }
        },
        {
            body: createAgentBody,
            detail: {summary: 'Create a new agent', security: [{BearerAuth: []}]},
        },
    )
    .get(
        '/:id',
        async ({params}) => {
            const [agent] = await db.select().from(agents).where(eq(agents.id, params.id)).limit(1)

            if (!agent) {
                return new Response(
                    JSON.stringify({success: false, error: {code: 'NOT_FOUND', message: 'Agent not found'}}),
                    {status: 404, headers: {'Content-Type': 'application/json'}},
                )
            }

            return {
                success: true,
                data: {
                    ...agent,
                    tools: (agent.tools as string[]) ?? [],
                    createdAt: agent.createdAt.toISOString(),
                    updatedAt: agent.updatedAt.toISOString(),
                    createdBy: agent.createdBy ?? undefined,
                },
            }
        },
        {
            params: t.Object({id: t.String()}),
            detail: {summary: 'Get agent by ID'},
        },
    )
    .put(
        '/:id',
        async ({params, body, JWT, cookie: {auth}}) => {
            const user = await requireUser(JWT, auth)
            const [existing] = await db.select().from(agents).where(eq(agents.id, params.id)).limit(1)

            if (!existing) {
                return new Response(
                    JSON.stringify({success: false, error: {code: 'NOT_FOUND', message: 'Agent not found'}}),
                    {status: 404, headers: {'Content-Type': 'application/json'}},
                )
            }

            if (existing.createdBy !== user.sub) {
                return new Response(
                    JSON.stringify({success: false, error: {code: 'FORBIDDEN', message: 'Not the owner'}}),
                    {status: 403, headers: {'Content-Type': 'application/json'}},
                )
            }

            const updateData: Record<string, unknown> = {updatedAt: new Date()}
            if (body.name !== undefined) updateData.name = body.name
            if (body.description !== undefined) updateData.description = body.description
            if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt
            if (body.modelProfile !== undefined) updateData.modelProfile = body.modelProfile
            if (body.maxSteps !== undefined) updateData.maxSteps = body.maxSteps
            if (body.tools !== undefined) updateData.tools = body.tools

            const [updated] = await db.update(agents).set(updateData).where(eq(agents.id, params.id)).returning()

            if (!updated) {
                return new Response(
                    JSON.stringify({success: false, error: {code: 'UPDATE_FAILED', message: 'Failed to update'}}),
                    {status: 500, headers: {'Content-Type': 'application/json'}},
                )
            }

            return {
                success: true,
                data: {
                    ...updated,
                    tools: (updated.tools as string[]) ?? [],
                    createdAt: updated.createdAt.toISOString(),
                    updatedAt: updated.updatedAt.toISOString(),
                    createdBy: updated.createdBy ?? undefined,
                },
            }
        },
        {
            params: t.Object({id: t.String()}),
            body: updateAgentBody,
            detail: {summary: 'Update an agent', security: [{BearerAuth: []}]},
        },
    )
    .delete(
        '/:id',
        async ({params, JWT, cookie: {auth}}) => {
            const user = await requireUser(JWT, auth)
            const [existing] = await db.select().from(agents).where(eq(agents.id, params.id)).limit(1)

            if (!existing) {
                return new Response(
                    JSON.stringify({success: false, error: {code: 'NOT_FOUND', message: 'Agent not found'}}),
                    {status: 404, headers: {'Content-Type': 'application/json'}},
                )
            }

            if (existing.createdBy !== user.sub) {
                return new Response(
                    JSON.stringify({success: false, error: {code: 'FORBIDDEN', message: 'Not the owner'}}),
                    {status: 403, headers: {'Content-Type': 'application/json'}},
                )
            }

            await db.delete(agents).where(eq(agents.id, params.id))
            return {success: true}
        },
        {
            params: t.Object({id: t.String()}),
            detail: {summary: 'Delete an agent', security: [{BearerAuth: []}]},
        },
    )
