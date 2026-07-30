import {Elysia, t} from 'elysia'
import {
    createUserAgent,
    deleteUserAgent,
    findUserAgent,
    listUserAgents,
    serializeAgent,
    updateUserAgent,
} from '../../services/agent-service.js'
import {recordAuditLog} from '../../services/audit-log-service.js'
import {authPlugin, requireAccessToken} from '../middleware/auth.js'
import {agentListQuery, createAgentBody, updateAgentBody} from '../schemas/agent.js'

export const agentRoutes = new Elysia({prefix: '/agents'})
    .use(authPlugin)
    .get(
        '/',
        async ({JWT, headers, query}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const result = await listUserAgents({userId: user.sub, page, pageSize})

            return {
                success: true,
                data: result.items.map(serializeAgent),
                pagination: {page, pageSize, total: result.total},
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
            const user = await requireAccessToken(JWT, headers.authorization)
            const agent = await createUserAgent({
                userId: user.sub,
                name: body.name,
                description: body.description,
                systemPrompt: body.systemPrompt,
                modelProfile: body.modelProfile,
                maxSteps: body.maxSteps,
                tools: body.tools,
            })

            await recordAuditLog({
                userId: user.sub,
                action: 'agent.create',
                resourceType: 'agent',
                resourceId: agent.id,
                details: {
                    name: agent.name,
                    modelProfile: agent.modelProfile,
                    tools: agent.tools,
                },
                request,
            })

            return {success: true, data: serializeAgent(agent)}
        },
        {
            body: createAgentBody,
            detail: {summary: 'Create a new agent', security: [{BearerAuth: []}]},
        },
    )
    .get(
        '/:id',
        async ({params, JWT, headers}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            const agent = await findUserAgent(user.sub, params.id)
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
            const user = await requireAccessToken(JWT, headers.authorization)
            const result = await updateUserAgent({
                userId: user.sub,
                agentId: params.id,
                name: body.name,
                description: body.description,
                systemPrompt: body.systemPrompt,
                modelProfile: body.modelProfile,
                maxSteps: body.maxSteps,
                tools: body.tools,
            })

            await recordAuditLog({
                userId: user.sub,
                action: 'agent.update',
                resourceType: 'agent',
                resourceId: result.agent.id,
                details: {changedFields: result.changedFields},
                request,
            })

            return {success: true, data: serializeAgent(result.agent)}
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
            const user = await requireAccessToken(JWT, headers.authorization)
            const deleted = await deleteUserAgent(user.sub, params.id)
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
