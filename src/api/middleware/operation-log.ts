import {STATUS_CODES} from 'node:http'
import {Elysia} from 'elysia'
import {db} from '../../db/index.js'
import {operationLogs} from '../../db/schema.js'
import {authenticateAccessToken, authPlugin} from './auth.js'
import {requestContextPlugin} from './request-context.js'

function resolveStatusCode(status: unknown, responseValue: unknown): number {
    if (responseValue instanceof Response) return responseValue.status
    if (typeof status === 'number') return status

    if (typeof status === 'string') {
        const matched = Object.entries(STATUS_CODES)
            .find(([, label]) => label === status)
        if (matched) return Number(matched[0])
    }

    return 200
}

function resolveClientIp(headers: Headers): string | null {
    const forwardedFor = headers.get('x-forwarded-for')
        ?.split(',')[0]
        ?.trim()
    const value = forwardedFor || headers.get('x-real-ip')?.trim()
    return value ? value.slice(0, 45) : null
}

export const operationLogPlugin = new Elysia({name: 'operation-log'})
    .use(authPlugin)
    .use(requestContextPlugin)
    .onAfterResponse(({
        request,
        set,
        responseValue,
        JWT,
        requestId,
        requestStartedAt,
    }) => {
        const path = new URL(request.url).pathname
        if (path.startsWith('/api/v1/health')) return

        const durationMs = Math.max(0, Math.round(performance.now() - requestStartedAt))
        const statusCode = resolveStatusCode(set.status, responseValue)

        void (async () => {
            try {
                const user = await authenticateAccessToken(
                    JWT,
                    request.headers.get('authorization') ?? undefined,
                )

                await db.insert(operationLogs).values({
                    requestId,
                    userId: user?.sub ?? null,
                    method: request.method.slice(0, 10),
                    path: path.slice(0, 255),
                    statusCode,
                    durationMs,
                    ipAddress: resolveClientIp(request.headers),
                    userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
                })
            } catch (error) {
                console.error('[operation-log] Failed to persist request log', {
                    requestId,
                    error,
                })
            }
        })()
    })
