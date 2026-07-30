import {Elysia, t} from 'elysia'
import {
    createUserAgent,
    deleteUserAgent,
    findUserAgent,
    listAgentVersions,
    listUserAgents,
    rollbackUserAgent,
    serializeAgent,
    updateUserAgent,
} from '../../services/agent-service.js'
import {recordAuditLog} from '../../services/audit-log-service.js'
import {authPlugin, requireAccessToken} from '../middleware/auth.js'
import {getRequestId} from '../middleware/request-context.js'
import {
    agentListQuery,
    createAgentBody,
    rollbackAgentBody,
    updateAgentBody,
} from '../schemas/agent.js'

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
                requestId: getRequestId(request),
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
                    version: agent.version,
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
        '/:id/versions',
        async ({params, query, JWT, headers}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const result = await listAgentVersions({
                userId: user.sub,
                agentId: params.id,
                page,
                pageSize,
            })

            return {
                success: true,
                data: result.items,
                pagination: {page, pageSize, total: result.total},
            }
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            query: agentListQuery,
            detail: {summary: 'List agent versions', security: [{BearerAuth: []}]},
        },
    )
    .post(
        '/:id/rollback',
        async ({params, body, JWT, headers, request}) => {
            const user = await requireAccessToken(JWT, headers.authorization)
            const result = await rollbackUserAgent({
                userId: user.sub,
                requestId: getRequestId(request),
                agentId: params.id,
                targetVersion: body.targetVersion,
            })

            await recordAuditLog({
                userId: user.sub,
                action: 'agent.rollback',
                resourceType: 'agent',
                resourceId: result.agent.id,
                details: {
                    newVersion: result.agent.version,
                    rolledBackFromVersion: result.rolledBackFromVersion,
                    restoredFromVersion: result.restoredFromVersion,
                },
                request,
            })

            return {
                success: true,
                data: {
                    agent: serializeAgent(result.agent),
                    rolledBackFromVersion: result.rolledBackFromVersion,
                    restoredFromVersion: result.restoredFromVersion,
                },
            }
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            body: rollbackAgentBody,
            detail: {summary: 'Rollback an agent configuration', security: [{BearerAuth: []}]},
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
                requestId: getRequestId(request),
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
                details: {
                    changedFields: result.changedFields,
                    version: result.agent.version,
                },
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
                details: {name: deleted.name, version: deleted.version},
                request,
            })

            return {success: true}
        },
        {
            params: t.Object({id: t.String({format: 'uuid'})}),
            detail: {summary: 'Delete an agent', security: [{BearerAuth: []}]},
        },
    )
