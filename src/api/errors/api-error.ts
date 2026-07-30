export interface ApiErrorDetails {
    [key: string]: unknown
}

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly details?: ApiErrorDetails,
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
): ApiError {
    return new ApiError(status, code, message, details)
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
