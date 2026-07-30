import {Elysia, t} from 'elysia'
import {desc, eq, and, gte, lte, sql} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {auditLogs, operationLogs} from '../../db/schema.js'
import {authPlugin} from '../middleware/auth.js'

async function requireUser(JWT: any, auth: any) {
    if (!auth?.value) throw new Error('Unauthorized')
    const payload = await JWT.verify(auth.value)
    if (!payload) throw new Error('Unauthorized')
    return payload as {sub: string; username: string}
}

const logQuery = t.Object({
    page: t.Optional(t.Number({default: 1})),
    pageSize: t.Optional(t.Number({default: 20, maximum: 100})),
    userId: t.Optional(t.String()),
    action: t.Optional(t.String()),
    method: t.Optional(t.String()),
    path: t.Optional(t.String()),
    startDate: t.Optional(t.String()),
    endDate: t.Optional(t.String()),
})

export const adminRoutes = new Elysia({prefix: '/admin'})
    .use(authPlugin)
    .get(
        '/audit-logs',
        async ({JWT, cookie: {auth}, query}) => {
            await requireUser(JWT, auth)
            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const offset = (page - 1) * pageSize

            const conditions = []
            if (query.userId) conditions.push(eq(auditLogs.userId, query.userId))
            if (query.action) conditions.push(eq(auditLogs.action, query.action))
            if (query.startDate) conditions.push(gte(auditLogs.createdAt, new Date(query.startDate)))
            if (query.endDate) conditions.push(lte(auditLogs.createdAt, new Date(query.endDate)))
            const where = conditions.length > 0 ? and(...conditions) : undefined

            const [countResult] = await db.select({count: sql<number>`count(*)::int`}).from(auditLogs).where(where)
            const items = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(pageSize).offset(offset)

            return {
                success: true,
                data: items.map((l) => ({...l, details: l.details ?? undefined, ipAddress: l.ipAddress ?? undefined, createdAt: l.createdAt.toISOString()})),
                pagination: {page, pageSize, total: countResult?.count ?? 0},
            }
        },
        {query: logQuery, detail: {summary: 'Query audit logs', security: [{BearerAuth: []}]}},
    )
    .get(
        '/operation-logs',
        async ({JWT, cookie: {auth}, query}) => {
            await requireUser(JWT, auth)
            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const offset = (page - 1) * pageSize

            const conditions = []
            if (query.userId) conditions.push(eq(operationLogs.userId, query.userId))
            if (query.method) conditions.push(eq(operationLogs.method, query.method))
            if (query.path) conditions.push(eq(operationLogs.path, query.path))
            if (query.startDate) conditions.push(gte(operationLogs.createdAt, new Date(query.startDate)))
            if (query.endDate) conditions.push(lte(operationLogs.createdAt, new Date(query.endDate)))
            const where = conditions.length > 0 ? and(...conditions) : undefined

            const [countResult] = await db.select({count: sql<number>`count(*)::int`}).from(operationLogs).where(where)
            const items = await db.select().from(operationLogs).where(where).orderBy(desc(operationLogs.createdAt)).limit(pageSize).offset(offset)

            return {
                success: true,
                data: items.map((l) => ({...l, statusCode: l.statusCode ?? undefined, durationMs: l.durationMs ?? undefined, createdAt: l.createdAt.toISOString()})),
                pagination: {page, pageSize, total: countResult?.count ?? 0},
            }
        },
        {query: logQuery, detail: {summary: 'Query operation logs', security: [{BearerAuth: []}]}},
    )
