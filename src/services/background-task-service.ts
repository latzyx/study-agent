import {env} from '../config/env.js'

interface PendingTask {
    name: string
    promise: Promise<void>
}

const pending = new Set<PendingTask>()
let rejectedTasks = 0

export function runBackgroundTask(name: string, operation: () => Promise<void>): boolean {
    if (pending.size >= env.backgroundTasks.maxPending) {
        rejectedTasks += 1
        console.error('[background-task] Queue capacity exceeded; task rejected', {
            name,
            pending: pending.size,
            rejectedTasks,
        })
        return false
    }

    const task: PendingTask = {
        name,
        promise: Promise.resolve(),
    }
    task.promise = Promise.resolve()
        .then(operation)
        .catch((error) => {
            console.error('[background-task] Task failed', {name, error})
        })
        .finally(() => {
            pending.delete(task)
        })
    pending.add(task)
    return true
}

export function backgroundTaskStats() {
    return {
        pending: pending.size,
        rejected: rejectedTasks,
    }
}

export async function drainBackgroundTasks(
    timeoutMs = env.backgroundTasks.shutdownTimeoutMs,
): Promise<{completed: boolean; remaining: number}> {
    const deadline = Date.now() + timeoutMs

    while (pending.size > 0) {
        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) {
            console.error('[background-task] Drain timed out', {remaining: pending.size})
            return {completed: false, remaining: pending.size}
        }

        const tasks = [...pending].map((task) => task.promise)
        await Promise.race([
            Promise.allSettled(tasks),
            new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, Math.min(remainingMs, 100))
                timer.unref?.()
            }),
        ])
    }

    return {completed: true, remaining: 0}
}

export function resetBackgroundTasksForTests(): void {
    pending.clear()
    rejectedTasks = 0
}
