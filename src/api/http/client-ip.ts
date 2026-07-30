import {env} from '../../config/env.js'

function firstHeaderValue(value: string | null): string | null {
    const first = value?.split(',')[0]?.trim()
    return first ? first.slice(0, 45) : null
}

export function resolveClientIp(headers: Headers): string | null {
    if (!env.server.trustProxyHeaders) return null

    return firstHeaderValue(headers.get('cf-connecting-ip'))
        ?? firstHeaderValue(headers.get('x-forwarded-for'))
        ?? firstHeaderValue(headers.get('x-real-ip'))
}
