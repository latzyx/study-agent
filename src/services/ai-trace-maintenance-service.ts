import {
    purgeExpiredAiTraces,
    recoverStaleAiRuns,
} from './ai-trace-service.js'
import {recoverStaleChatRequests} from './chat-idempotency-service.js'

const STALE_RUN_MINUTES = 60
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000

async function runMaintenance(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000)
    const [recoveredRuns, recoveredRequests, purged] = await Promise.all([
        recoverStaleAiRuns(STALE_RUN_MINUTES),
        recoverStaleChatRequests(staleBefore),
        purgeExpiredAiTraces(),
    ])

    if (recoveredRuns > 0 || recoveredRequests > 0 || purged > 0) {
        console.log('[maintenance] Completed', {
            recoveredRuns,
            recoveredRequests,
            purgedTraces: purged,
        })
    }
}

export function startAiTraceMaintenance(): () => void {
    let stopped = false

    const execute = () => {
        if (stopped) return
        void runMaintenance().catch((error) => {
            console.error('[maintenance] Failed', error)
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
