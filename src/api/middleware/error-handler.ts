import {Elysia} from 'elysia'
import {env} from '../../config/env.js'
import {ApiError, errorPayload} from '../errors/api-error.js'
import {requestContextPlugin} from './request-context.js'

function jsonError(
    status: number,
    code: string,
    message: string,
    requestId: string,
    details?: Record<string, unknown>,
): Response {
    return Response.json(
        errorPayload(code, message, details, requestId),
        {status, headers: {'x-request-id': requestId}},
    )
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export const errorHandlerPlugin = new Elysia({name: 'error-handler'})
    .use(requestContextPlugin)
    .onError({as: 'global'}, ({code, error, request, requestId}) => {
        const resolvedRequestId = requestId
            ?? request.headers.get('x-request-id')
            ?? crypto.randomUUID()

        if (error instanceof ApiError) {
            return jsonError(
                error.status,
                error.code,
                error.message,
                resolvedRequestId,
                error.details,
            )
        }

        if (code === 'VALIDATION') {
            return jsonError(
                422,
                'VALIDATION_ERROR',
                'Request validation failed',
                resolvedRequestId,
                env.isProduction ? undefined : {reason: errorMessage(error)},
            )
        }

        if (code === 'PARSE') {
            return jsonError(
                400,
                'INVALID_REQUEST_BODY',
                'Unable to parse request body',
                resolvedRequestId,
            )
        }

        if (code === 'NOT_FOUND') {
            return jsonError(404, 'ROUTE_NOT_FOUND', 'Route not found', resolvedRequestId)
        }

        console.error('[api:error]', {
            requestId: resolvedRequestId,
            method: request.method,
            path: new URL(request.url).pathname,
            error,
        })

        return jsonError(
            500,
            'INTERNAL_SERVER_ERROR',
            env.isProduction ? 'Internal server error' : errorMessage(error),
            resolvedRequestId,
        )
    })
