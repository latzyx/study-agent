import {resolveClientIp} from '../api/http/client-ip.js'
import {env} from '../config/env.js'
import {
    enforceRateLimit,
    FixedWindowRateLimiter,
    type RateLimitDecision,
} from './rate-limit-service.js'

function createLimiter(policy: {limit: number; windowMs: number}) {
    return new FixedWindowRateLimiter({
        ...policy,
        maxKeys: env.limits.maxKeys,
    })
}

const loginLimiter = createLimiter(env.limits.authLogin)
const registerLimiter = createLimiter(env.limits.authRegister)
const refreshLimiter = createLimiter(env.limits.authRefresh)
const chatLimiter = createLimiter(env.limits.chat)

function requestFingerprint(request: Request): string {
    const ip = resolveClientIp(request.headers)
    if (ip) return `ip:${ip}`

    const userAgent = request.headers.get('user-agent')?.slice(0, 160) ?? 'unknown-agent'
    const language = request.headers.get('accept-language')?.slice(0, 80) ?? 'unknown-language'
    return `client:${userAgent}:${language}`
}

function consumeAndEnforce(
    limiter: FixedWindowRateLimiter,
    key: string,
    code: string,
    message: string,
): RateLimitDecision {
    const decision = limiter.consume(key)
    enforceRateLimit(decision, code, message)
    return decision
}

export function enforceLoginRateLimit(request: Request, email: string): RateLimitDecision {
    return consumeAndEnforce(
        loginLimiter,
        `login:${email}:${requestFingerprint(request)}`,
        'LOGIN_RATE_LIMITED',
        'Too many login attempts. Try again later.',
    )
}

export function resetLoginRateLimit(request: Request, email: string): void {
    loginLimiter.reset(`login:${email}:${requestFingerprint(request)}`)
}

export function enforceRegisterRateLimit(request: Request, email: string): RateLimitDecision {
    return consumeAndEnforce(
        registerLimiter,
        `register:${email}:${requestFingerprint(request)}`,
        'REGISTER_RATE_LIMITED',
        'Too many registration attempts. Try again later.',
    )
}

export function enforceRefreshRateLimit(request: Request, token: string): RateLimitDecision {
    const tokenSuffix = token.slice(-64)
    return consumeAndEnforce(
        refreshLimiter,
        `refresh:${tokenSuffix}:${requestFingerprint(request)}`,
        'REFRESH_RATE_LIMITED',
        'Too many token refresh attempts. Try again later.',
    )
}

export function enforceChatRateLimit(userId: string): RateLimitDecision {
    return consumeAndEnforce(
        chatLimiter,
        `chat:${userId}`,
        'CHAT_RATE_LIMITED',
        'Too many chat requests. Try again later.',
    )
}
