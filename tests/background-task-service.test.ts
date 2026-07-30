import {beforeEach, describe, expect, test} from 'bun:test'
import {
    backgroundTaskStats,
    drainBackgroundTasks,
    resetBackgroundTasksForTests,
    runBackgroundTask,
} from '../src/services/background-task-service'

beforeEach(() => resetBackgroundTasksForTests())

describe('background task service', () => {
    test('tracks and drains pending tasks', async () => {
        const completed: number[] = []

        runBackgroundTask('first', async () => {
            await Bun.sleep(10)
            completed.push(1)
        })
        runBackgroundTask('second', async () => {
            await Bun.sleep(5)
            completed.push(2)
        })

        expect(backgroundTaskStats().pending).toBe(2)
        const result = await drainBackgroundTasks(1000)

        expect(result).toEqual({completed: true, remaining: 0})
        expect(backgroundTaskStats().pending).toBe(0)
        expect(completed.sort()).toEqual([1, 2])
    })

    test('removes failed tasks from the pending set', async () => {
        runBackgroundTask('failure', async () => {
            throw new Error('expected test failure')
        })

        const result = await drainBackgroundTasks(1000)
        expect(result.completed).toBe(true)
        expect(backgroundTaskStats().pending).toBe(0)
    })
})
