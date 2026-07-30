import {env} from '../config/env.js'
import {closeDatabaseConnection} from '../db/index.js'
import {startAiTraceMaintenance} from '../services/ai-trace-maintenance-service.js'
import {createApp} from './create-app.js'

const app = createApp().listen({
    port: env.server.port,
    hostname: env.server.host,
})
const stopTraceMaintenance = startAiTraceMaintenance()

let shutdownPromise: Promise<void> | null = null

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shutdownPromise) return shutdownPromise

    shutdownPromise = (async () => {
        console.log(`[shutdown] Received ${signal}; stopping background maintenance`)
        stopTraceMaintenance()

        console.log('[shutdown] Stopping HTTP server')
        await app.stop()

        console.log('[shutdown] Closing database connections')
        await closeDatabaseConnection()

        console.log('[shutdown] Complete')
    })()

    return shutdownPromise
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        void shutdown(signal)
            .then(() => {
                process.exitCode = 0
            })
            .catch((error) => {
                console.error('[shutdown] Failed', error)
                process.exitCode = 1
            })
    })
}

console.log(
    `Study Agent API: http://${app.server?.hostname}:${app.server?.port}`,
    `\nSwagger: http://${app.server?.hostname}:${app.server?.port}/docs`,
)

export {app}
