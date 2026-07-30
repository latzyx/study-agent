import {Elysia, t} from 'elysia'
import {and, desc, eq, gte, lte, sql, type SQL} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {auditLogs, operationLogs} from '../../db/schema.js'
import {createApiError} from '../errors/api-error.js'
import {
    authenticateAccessToken,
    authPlugin,
    forbiddenResponse,
    hasAdminAccess,
    unauthorizedResponse,
} from '../middleware/auth.js'

const logQuery = t.Object({
    page: t.Optional(t.Number({default: 1, minimum: 1})),
    pageSize: t.Optional(t.Number({default: 20, minimum: 1, maximum: 100})),
    userId: t.Optional(t.String({format: 'uuid'})),
    action: t.Optional(t.String({maxLength: 50})),
    method: t.Optional(t.String({maxLength: 10})),
    path: t.Optional(t.String({maxLength: 255})),
    requestId: t.Optional(t.String({maxLength: 100})),
    statusCode: t.Optional(t.Number({minimum: 100, maximum: 599})),
    startDate: t.Optional(t.String()),
    endDate: t.Optional(t.String()),
})

function parseOptionalDate(value: string | undefined, field: string): Date | null {
    if (!value) return null

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        throw createApiError(400, 'INVALID_DATE_FILTER', `${field} must be a valid date`)
    }

    return date
}

function resolveDateRange(startValue?: string, endValue?: string) {
    const startDate = parseOptionalDate(startValue, 'startDate')
    const endDate = parseOptionalDate(endValue, 'endDate')

    if (startDate && endDate && startDate > endDate) {
        throw createApiError(
            400,
            'INVALID_DATE_RANGE',
            'startDate must be earlier than or equal to endDate',
        )
    }

    return {startDate, endDate}
}

async function requireAdmin(JWT: any, authorization?: string) {
    const user = await authenticateAccessToken(JWT, authorization)
    if (!user) return {response: unauthorizedResponse()}
    if (!hasAdminAccess(user)) return {response: forbiddenResponse('Administrator access required')}
    return {user}
}

export const adminRoutes = new Elysia({prefix: '/admin'})
    .use(authPlugin)
    .get(
        '/audit-logs',
        async ({JWT, headers, query}) => {
            const auth = await requireAdmin(JWT, headers.authorization)
            if ('response' in auth) return auth.response

            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const offset = (page - 1) * pageSize
            const conditions: SQL[] = []
            const {startDate, endDate} = resolveDateRange(query.startDate, query.endDate)

            if (query.userId) conditions.push(eq(auditLogs.userId, query.userId))
            if (query.action) conditions.push(eq(auditLogs.action, query.action))
            if (startDate) conditions.push(gte(auditLogs.createdAt, startDate))
            if (endDate) conditions.push(lte(auditLogs.createdAt, endDate))
            const where = conditions.length > 0 ? and(...conditions) : undefined

            const [countResult] = await db.select({count: sql<number>`count(*)::int`})
                .from(auditLogs)
                .where(where)
            const items = await db.select()
                .from(auditLogs)
                .where(where)
                .orderBy(desc(auditLogs.createdAt))
                .limit(pageSize)
                .offset(offset)

            return {
                success: true,
                data: items.map((item) => ({
                    ...item,
                    details: item.details ?? undefined,
                    ipAddress: item.ipAddress ?? undefined,
                    createdAt: item.createdAt.toISOString(),
                })),
                pagination: {page, pageSize, total: countResult?.count ?? 0},
            }
        },
        {query: logQuery, detail: {summary: 'Query audit logs', security: [{BearerAuth: []}]}},
    )
    .get(
        '/operation-logs',
        async ({JWT, headers, query}) => {
            const auth = await requireAdmin(JWT, headers.authorization)
            if ('response' in auth) return auth.response

            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const offset = (page - 1) * pageSize
            const conditions: SQL[] = []
            const {startDate, endDate} = resolveDateRange(query.startDate, query.endDate)

            if (query.userId) conditions.push(eq(operationLogs.userId, query.userId))
            if (query.method) conditions.push(eq(operationLogs.method, query.method.toUpperCase()))
            if (query.path) conditions.push(eq(operationLogs.path, query.path))
            if (query.requestId) conditions.push(eq(operationLogs.requestId, query.requestId))
            if (query.statusCode) conditions.push(eq(operationLogs.statusCode, query.statusCode))
            if (startDate) conditions.push(gte(operationLogs.createdAt, startDate))
            if (endDate) conditions.push(lte(operationLogs.createdAt, endDate))
            const where = conditions.length > 0 ? and(...conditions) : undefined

            const [countResult] = await db.select({count: sql<number>`count(*)::int`})
                .from(operationLogs)
                .where(where)
            const items = await db.select()
                .from(operationLogs)
                .where(where)
                .orderBy(desc(operationLogs.createdAt))
                .limit(pageSize)
                .offset(offset)

            return {
                success: true,
                data: items.map((item) => ({
                    ...item,
                    userId: item.userId ?? undefined,
                    ipAddress: item.ipAddress ?? undefined,
                    userAgent: item.userAgent ?? undefined,
                    createdAt: item.createdAt.toISOString(),
                })),
                pagination: {page, pageSize, total: countResult?.count ?? 0},
            }
        },
        {query: logQuery, detail: {summary: 'Query operation logs', security: [{BearerAuth: []}]}},
    )
