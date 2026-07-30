import {
    purgeExpiredAiTraces,
    recoverStaleAiRuns,
} from './ai-trace-service.js'

const STALE_RUN_MINUTES = 60
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000

async function runMaintenance(): Promise<void> {
    const [recovered, purged] = await Promise.all([
        recoverStaleAiRuns(STALE_RUN_MINUTES),
        purgeExpiredAiTraces(),
    ])

    if (recovered > 0 || purged > 0) {
        console.log('[ai-trace] Maintenance completed', {recovered, purged})
    }
}

export function startAiTraceMaintenance(): () => void {
    let stopped = false

    const execute = () => {
        if (stopped) return
        void runMaintenance().catch((error) => {
            console.error('[ai-trace] Maintenance failed', error)
        })
    }

    execute()
    const timer = setInterval(execute, MAINTENANCE_INTERVAL_MS)
    timer.unref()

    return () => {
        stopped = true
        clearInterval(timer)
    }
}
