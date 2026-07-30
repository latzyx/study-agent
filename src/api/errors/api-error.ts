export interface ApiErrorDetails {
    [key: string]: unknown
}

export type ApiErrorHeaders = Record<string, string>

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly details?: ApiErrorDetails,
        public readonly headers?: ApiErrorHeaders,
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

export function createApiError(
    status: number,
    code: string,
    message: string,
    details?: ApiErrorDetails,
    headers?: ApiErrorHeaders,
): ApiError {
    return new ApiError(status, code, message, details, headers)
}

export function errorPayload(
    code: string,
    message: string,
    details?: ApiErrorDetails,
    requestId?: string,
) {
    return {
        success: false as const,
        error: {
            code,
            message,
            ...(details ? {details} : {}),
            ...(requestId ? {requestId} : {}),
        },
    }
}
