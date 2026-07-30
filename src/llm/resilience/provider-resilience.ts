import {env} from '../../config/env.js'

export interface ResilienceAttemptContext {
    attempt: number
    signal: AbortSignal
}

interface CircuitState {
    failures: number
    openedAt?: number
    halfOpenInFlight: boolean
}

const circuits = new Map<string, CircuitState>()

function circuitFor(key: string): CircuitState {
    const existing = circuits.get(key)
    if (existing) return existing
    const created: CircuitState = {failures: 0, halfOpenInFlight: false}
    circuits.set(key, created)
    return created
}

function errorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined
    const candidate = error as Record<string, unknown>
    for (const key of ['status', 'statusCode', 'httpStatusCode']) {
        const value = candidate[key]
        if (typeof value === 'number') return value
    }
    return undefined
}

export function isAbortError(error: unknown): boolean {
    return error instanceof DOMException
        ? error.name === 'AbortError' || error.name === 'TimeoutError'
        : error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)
}

export function isTransientProviderError(error: unknown): boolean {
    if (isAbortError(error)) return true
    const status = errorStatus(error)
    if (status === 408 || status === 409 || status === 425 || status === 429) return true
    if (status !== undefined && status >= 500) return true
    const message = error instanceof Error ? error.message : String(error)
    return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network|socket|temporar|rate.?limit|overloaded|unavailable|gateway/i.test(message)
}

function createCombinedSignal(parent?: AbortSignal): {signal: AbortSignal; cleanup: () => void} {
    const timeoutController = new AbortController()
    const timer = setTimeout(() => {
        timeoutController.abort(new DOMException('Provider request timed out', 'TimeoutError'))
    }, env.providers.requestTimeoutMs)
    timer.unref?.()

    if (!parent) {
        return {
            signal: timeoutController.signal,
            cleanup: () => clearTimeout(timer),
        }
    }

    const controller = new AbortController()
    const abort = (reason: unknown) => {
        if (!controller.signal.aborted) controller.abort(reason)
    }
    const onParentAbort = () => abort(parent.reason)
    const onTimeoutAbort = () => abort(timeoutController.signal.reason)
    parent.addEventListener('abort', onParentAbort, {once: true})
    timeoutController.signal.addEventListener('abort', onTimeoutAbort, {once: true})
    if (parent.aborted) abort(parent.reason)

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timer)
            parent.removeEventListener('abort', onParentAbort)
            timeoutController.signal.removeEventListener('abort', onTimeoutAbort)
        },
    }
}

function assertCircuitAvailable(key: string): CircuitState {
    const state = circuitFor(key)
    if (!state.openedAt) return state

    const elapsed = Date.now() - state.openedAt
    if (elapsed < env.providers.circuitResetMs) {
        const error = new Error(`Provider circuit is open for ${key}`)
        error.name = 'ProviderCircuitOpenError'
        throw error
    }

    if (state.halfOpenInFlight) {
        const error = new Error(`Provider circuit half-open probe is already running for ${key}`)
        error.name = 'ProviderCircuitOpenError'
        throw error
    }

    state.halfOpenInFlight = true
    return state
}

function recordSuccess(state: CircuitState): void {
    state.failures = 0
    state.openedAt = undefined
    state.halfOpenInFlight = false
}

function recordFailure(state: CircuitState): void {
    state.halfOpenInFlight = false
    state.failures += 1
    if (state.failures >= env.providers.circuitFailureThreshold) {
        state.openedAt = Date.now()
    }
}

function retryDelay(attempt: number): number {
    const exponential = env.providers.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1)
    const jitter = Math.floor(Math.random() * Math.max(1, env.providers.retryBaseDelayMs))
    return Math.min(10_000, exponential + jitter)
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal?.reason)
        }
        signal?.addEventListener('abort', onAbort, {once: true})
        timer.refresh?.()
    })
}

export async function executeProviderRequest<T>(input: {
    key: string
    parentSignal?: AbortSignal
    operation: (context: ResilienceAttemptContext) => Promise<T>
}): Promise<T> {
    const state = assertCircuitAvailable(input.key)
    let lastError: unknown

    for (let attempt = 1; attempt <= env.providers.maxRetries + 1; attempt++) {
        const attemptSignal = createCombinedSignal(input.parentSignal)
        try {
            const result = await input.operation({attempt, signal: attemptSignal.signal})
            recordSuccess(state)
            return result
        } catch (error) {
            lastError = error
            const parentAborted = input.parentSignal?.aborted === true
            const canRetry = !parentAborted
                && attempt <= env.providers.maxRetries
                && isTransientProviderError(error)
            if (!canRetry) {
                recordFailure(state)
                throw error
            }
        } finally {
            attemptSignal.cleanup()
        }

        await sleep(retryDelay(attempt), input.parentSignal)
    }

    recordFailure(state)
    throw lastError
}

export async function *streamProviderRequest<T>(input: {
    key: string
    parentSignal?: AbortSignal
    operation: (context: ResilienceAttemptContext) => AsyncIterable<T>
}): AsyncGenerator<T> {
    const state = assertCircuitAvailable(input.key)
    let lastError: unknown

    for (let attempt = 1; attempt <= env.providers.maxRetries + 1; attempt++) {
        const attemptSignal = createCombinedSignal(input.parentSignal)
        let emitted = false
        try {
            for await (const event of input.operation({attempt, signal: attemptSignal.signal})) {
                emitted = true
                yield event
            }
            recordSuccess(state)
            return
        } catch (error) {
            lastError = error
            const parentAborted = input.parentSignal?.aborted === true
            const canRetry = !emitted
                && !parentAborted
                && attempt <= env.providers.maxRetries
                && isTransientProviderError(error)
            if (!canRetry) {
                recordFailure(state)
                throw error
            }
        } finally {
            attemptSignal.cleanup()
        }

        await sleep(retryDelay(attempt), input.parentSignal)
    }

    recordFailure(state)
    throw lastError
}

export function resetProviderCircuitsForTests(): void {
    circuits.clear()
}
