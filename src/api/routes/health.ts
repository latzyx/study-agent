import {Elysia} from 'elysia'
import {env} from '../../config/env.js'
import {checkDatabaseConnection} from '../../db/index.js'

function serviceStatus() {
    return {
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`Health check timed out after ${timeoutMs}ms`)),
                    timeoutMs,
                )
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

export const healthRoutes = new Elysia({prefix: '/health'})
    .get('/', serviceStatus, {detail: {summary: 'Service liveness check'}})
    .get('/live', serviceStatus, {detail: {summary: 'Service liveness check'}})
    .get(
        '/ready',
        async () => {
            try {
                await withTimeout(
                    checkDatabaseConnection(),
                    env.database.healthcheckTimeoutMs,
                )

                return {
                    ...serviceStatus(),
                    dependencies: {database: 'ok' as const},
                }
            } catch (error) {
                console.error('[health] Database readiness check failed', error)

                return Response.json({
                    status: 'unavailable',
                    timestamp: new Date().toISOString(),
                    dependencies: {database: 'unavailable'},
                    ...(!env.isProduction && {
                        error: error instanceof Error ? error.message : String(error),
                    }),
                }, {status: 503})
            }
        },
        {detail: {summary: 'Service readiness check'}},
    )
