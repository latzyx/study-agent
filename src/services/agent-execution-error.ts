import {createApiError} from '../api/errors/api-error.js'
import {env} from '../config/env.js'
import {LLMProviderError} from '../llm/domain/llm-provider.js'

function developmentMessage(error: Error, fallback: string): string {
    return env.isProduction ? fallback : error.message
}

export function toAgentExecutionApiError(error: Error) {
    if (error instanceof LLMProviderError) {
        switch (error.code) {
            case 'ABORTED':
                return createApiError(499, 'REQUEST_ABORTED', 'Request was aborted')
            case 'TIMEOUT':
                return createApiError(504, 'LLM_TIMEOUT', developmentMessage(error, 'Model request timed out'))
            case 'RATE_LIMITED':
                return createApiError(429, 'LLM_RATE_LIMITED', developmentMessage(error, 'Model provider rate limit exceeded'))
            case 'PROVIDER_UNAVAILABLE':
                return createApiError(503, 'LLM_PROVIDER_UNAVAILABLE', developmentMessage(error, 'Model provider is unavailable'))
            case 'AUTHENTICATION':
                return createApiError(502, 'LLM_PROVIDER_AUTHENTICATION_FAILED', 'Model provider authentication failed')
            case 'INVALID_REQUEST':
                return createApiError(500, 'INVALID_LLM_RUNTIME_REQUEST', developmentMessage(error, 'Model runtime request is invalid'))
            case 'UNKNOWN':
                return createApiError(502, 'AGENT_EXECUTION_FAILED', developmentMessage(error, 'Agent execution failed'))
        }
    }

    const normalized = `${error.name} ${error.message}`.toLowerCase()
    if (normalized.includes('aborted')) {
        return createApiError(499, 'REQUEST_ABORTED', 'Request was aborted')
    }
    if (normalized.includes('max steps')) {
        return createApiError(422, 'AGENT_MAX_STEPS_EXCEEDED', developmentMessage(error, 'Agent exceeded its execution step limit'))
    }
    if (normalized.includes('tool') || normalized.includes('model')) {
        return createApiError(502, 'AGENT_EXECUTION_FAILED', developmentMessage(error, 'Agent execution failed'))
    }

    return createApiError(500, 'AGENT_RUNTIME_FAILED', developmentMessage(error, 'Agent runtime failed'))
}
