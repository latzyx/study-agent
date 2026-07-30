import {Elysia} from 'elysia'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/
const requestIds = new WeakMap<Request, string>()

function resolveRequestId(request: Request): string {
    const provided = request.headers.get('x-request-id')?.trim()
    return provided && REQUEST_ID_PATTERN.test(provided)
        ? provided
        : crypto.randomUUID()
}

export function getRequestId(request: Request): string {
    const existing = requestIds.get(request)
    if (existing) return existing

    const requestId = resolveRequestId(request)
    requestIds.set(request, requestId)
    return requestId
}

export const requestContextPlugin = new Elysia({name: 'request-context'})
    .derive({as: 'global'}, ({request, set}) => {
        const requestId = getRequestId(request)
        set.headers['x-request-id'] = requestId

        return {
            requestId,
            requestStartedAt: performance.now(),
        }
    })
