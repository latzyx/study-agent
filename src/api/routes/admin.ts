import {Elysia, t} from 'elysia'
import {and, asc, desc, eq, gte, lte, sql, type SQL} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {aiRuns, aiSpans, auditLogs, operationLogs} from '../../db/schema.js'
import {createApiError} from '../errors/api-error.js'
import {authPlugin, requireAdminAccess} from '../middleware/auth.js'

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

const traceQuery = t.Object({
    page: t.Optional(t.Number({default: 1, minimum: 1})),
    pageSize: t.Optional(t.Number({default: 20, minimum: 1, maximum: 100})),
    userId: t.Optional(t.String({format: 'uuid'})),
    agentId: t.Optional(t.String({format: 'uuid'})),
    sessionId: t.Optional(t.String({maxLength: 100})),
    requestId: t.Optional(t.String({maxLength: 100})),
    status: t.Optional(t.Union([
        t.Literal('running'),
        t.Literal('success'),
        t.Literal('error'),
        t.Literal('aborted'),
    ])),
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

function serializeAiRun(run: typeof aiRuns.$inferSelect) {
    return {
        ...run,
        userId: run.userId ?? undefined,
        agentId: run.agentId ?? undefined,
        conversationId: run.conversationId ?? undefined,
        requestId: run.requestId ?? undefined,
        sessionId: run.sessionId ?? undefined,
        inputSnapshot: run.inputSnapshot ?? undefined,
        outputSnapshot: run.outputSnapshot ?? undefined,
        metadata: run.metadata ?? undefined,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString(),
        createdAt: run.createdAt.toISOString(),
    }
}

function serializeAiSpan(span: typeof aiSpans.$inferSelect) {
    return {
        ...span,
        parentSpanKey: span.parentSpanKey ?? undefined,
        toolCallId: span.toolCallId ?? undefined,
        inputSnapshot: span.inputSnapshot ?? undefined,
        outputSnapshot: span.outputSnapshot ?? undefined,
        metadata: span.metadata ?? undefined,
        startedAt: span.startedAt.toISOString(),
        finishedAt: span.finishedAt?.toISOString(),
        createdAt: span.createdAt.toISOString(),
    }
}

export const adminRoutes = new Elysia({prefix: '/admin'})
    .use(authPlugin)
    .get(
        '/audit-logs',
        async ({JWT, headers, query}) => {
            await requireAdminAccess(JWT, headers.authorization)
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

            const [countResult, items] = await Promise.all([
                db.select({count: sql<number>`count(*)::int`})
                    .from(auditLogs)
                    .where(where)
                    .then((rows) => rows[0]),
                db.select()
                    .from(auditLogs)
                    .where(where)
                    .orderBy(desc(auditLogs.createdAt))
                    .limit(pageSize)
                    .offset(offset),
            ])

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
            await requireAdminAccess(JWT, headers.authorization)
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

            const [countResult, items] = await Promise.all([
                db.select({count: sql<number>`count(*)::int`})
                    .from(operationLogs)
                    .where(where)
                    .then((rows) => rows[0]),
                db.select()
                    .from(operationLogs)
                    .where(where)
                    .orderBy(desc(operationLogs.createdAt))
                    .limit(pageSize)
                    .offset(offset),
            ])

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
    .get(
        '/ai-traces',
        async ({JWT, headers, query}) => {
            await requireAdminAccess(JWT, headers.authorization)
            const page = query.page ?? 1
            const pageSize = query.pageSize ?? 20
            const offset = (page - 1) * pageSize
            const conditions: SQL[] = []
            const {startDate, endDate} = resolveDateRange(query.startDate, query.endDate)

            if (query.userId) conditions.push(eq(aiRuns.userId, query.userId))
            if (query.agentId) conditions.push(eq(aiRuns.agentId, query.agentId))
            if (query.sessionId) conditions.push(eq(aiRuns.sessionId, query.sessionId))
            if (query.requestId) conditions.push(eq(aiRuns.requestId, query.requestId))
            if (query.status) conditions.push(eq(aiRuns.status, query.status))
            if (startDate) conditions.push(gte(aiRuns.createdAt, startDate))
            if (endDate) conditions.push(lte(aiRuns.createdAt, endDate))
            const where = conditions.length > 0 ? and(...conditions) : undefined

            const [countResult, items] = await Promise.all([
                db.select({count: sql<number>`count(*)::int`})
                    .from(aiRuns)
                    .where(where)
                    .then((rows) => rows[0]),
                db.select()
                    .from(aiRuns)
                    .where(where)
                    .orderBy(desc(aiRuns.createdAt))
                    .limit(pageSize)
                    .offset(offset),
            ])

            return {
                success: true,
                data: items.map(serializeAiRun),
                pagination: {page, pageSize, total: countResult?.count ?? 0},
            }
        },
        {
            query: traceQuery,
            detail: {summary: 'Query AI traces across users', security: [{BearerAuth: []}]},
        },
    )
    .get(
        '/ai-traces/:traceId',
        async ({JWT, headers, params}) => {
            await requireAdminAccess(JWT, headers.authorization)
            const [run] = await db.select().from(aiRuns)
                .where(eq(aiRuns.traceId, params.traceId))
                .limit(1)
            if (!run) throw createApiError(404, 'TRACE_NOT_FOUND', 'AI trace not found')

            const spans = await db.select().from(aiSpans)
                .where(eq(aiSpans.runId, run.id))
                .orderBy(asc(aiSpans.startedAt))

            return {
                success: true,
                data: {
                    run: serializeAiRun(run),
                    spans: spans.map(serializeAiSpan),
                },
            }
        },
        {
            params: t.Object({traceId: t.String({format: 'uuid'})}),
            detail: {summary: 'Get any AI trace with spans', security: [{BearerAuth: []}]},
        },
    )
