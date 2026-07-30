import {Elysia} from 'elysia'
import {authenticateUser, normalizedLoginEmail, registerUser} from '../../services/auth-service.js'
import {recordAuditLog} from '../../services/audit-log-service.js'
import {
    enforceLoginRateLimit,
    enforceRefreshRateLimit,
    enforceRegisterRateLimit,
    resetLoginRateLimit,
} from '../../services/request-guard-service.js'
import {
    issueTokenPair,
    revokeRefreshToken,
    rotateRefreshToken,
} from '../../services/token-service.js'
import {authPlugin} from '../middleware/auth.js'
import {loginBody, refreshBody, registerBody} from '../schemas/auth.js'

function disableAuthResponseCaching(set: {
    headers: Record<string, string | number>
}): void {
    set.headers['cache-control'] = 'no-store'
    set.headers.pragma = 'no-cache'
}

export const authRoutes = new Elysia({prefix: '/auth'})
    .use(authPlugin)
    .post(
        '/register',
        async ({body, JWT, request, set}) => {
            disableAuthResponseCaching(set)
            const email = normalizedLoginEmail(body.email)
            enforceRegisterRateLimit(request, email)

            const user = await registerUser(body)
            const tokens = await issueTokenPair(JWT, user)
            await recordAuditLog({
                userId: user.id,
                action: 'auth.register',
                resourceType: 'user',
                resourceId: user.id,
                details: {username: user.username},
                request,
            })

            return {
                success: true,
                data: {user, ...tokens},
            }
        },
        {body: registerBody, detail: {summary: 'Register a new user'}},
    )
    .post(
        '/login',
        async ({body, JWT, request, set}) => {
            disableAuthResponseCaching(set)
            const email = normalizedLoginEmail(body.email)
            enforceLoginRateLimit(request, email)

            const user = await authenticateUser(email, body.password)
            resetLoginRateLimit(request, email)
            const tokens = await issueTokenPair(JWT, user)
            await recordAuditLog({
                userId: user.id,
                action: 'auth.login',
                resourceType: 'user',
                resourceId: user.id,
                request,
            })

            return {
                success: true,
                data: {user, ...tokens},
            }
        },
        {body: loginBody, detail: {summary: 'Login with email and password'}},
    )
    .post(
        '/refresh',
        async ({body, JWT, request, set}) => {
            disableAuthResponseCaching(set)
            enforceRefreshRateLimit(request, body.token)

            const {user, tokens} = await rotateRefreshToken(JWT, body.token)
            await recordAuditLog({
                userId: user.id,
                action: 'auth.refresh',
                resourceType: 'user',
                resourceId: user.id,
                request,
            })

            return {
                success: true,
                data: {user, ...tokens},
            }
        },
        {body: refreshBody, detail: {summary: 'Rotate refresh token'}},
    )
    .post(
        '/logout',
        async ({body, JWT, request, set}) => {
            disableAuthResponseCaching(set)
            enforceRefreshRateLimit(request, body.token)

            const revoked = await revokeRefreshToken(JWT, body.token)
            await recordAuditLog({
                action: 'auth.logout',
                resourceType: 'refresh_token',
                details: {revoked},
                request,
            })

            return {success: true}
        },
        {body: refreshBody, detail: {summary: 'Revoke refresh token'}},
    )
