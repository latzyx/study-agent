import {Elysia} from 'elysia'
import {eq} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {users} from '../../db/schema.js'
import {recordAuditLog} from '../../services/audit-log-service.js'
import {
    issueTokenPair,
    revokeRefreshToken,
    rotateRefreshToken,
} from '../../services/token-service.js'
import {authPlugin} from '../middleware/auth.js'
import {loginBody, refreshBody, registerBody} from '../schemas/auth.js'

function errorResponse(status: number, code: string, message: string): Response {
    return Response.json({success: false, error: {code, message}}, {status})
}

export const authRoutes = new Elysia({prefix: '/auth'})
    .use(authPlugin)
    .post(
        '/register',
        // @ts-ignore - Elysia body type inference
        async ({body, JWT, request}) => {
            const email = body.email.trim().toLowerCase()
            const username = body.username.trim()
            const passwordHash = await Bun.password.hash(body.password)

            const [newUser] = await db.insert(users).values({
                username,
                email,
                passwordHash,
            })
                .onConflictDoNothing()
                .returning({id: users.id, username: users.username, email: users.email})

            if (!newUser) {
                return errorResponse(409, 'USER_EXISTS', 'Email or username is already registered')
            }

            const tokens = await issueTokenPair(JWT, newUser)
            await recordAuditLog({
                userId: newUser.id,
                action: 'auth.register',
                resourceType: 'user',
                resourceId: newUser.id,
                details: {username: newUser.username},
                request,
            })

            return {
                success: true,
                data: {
                    user: newUser,
                    ...tokens,
                },
            }
        },
        {body: registerBody, detail: {summary: 'Register a new user'}},
    )
    .post(
        '/login',
        // @ts-ignore - Elysia body type inference
        async ({body, JWT, request}) => {
            const email = body.email.trim().toLowerCase()
            const [found] = await db.select().from(users).where(eq(users.email, email)).limit(1)

            if (!found || !(await Bun.password.verify(body.password, found.passwordHash))) {
                return errorResponse(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
            }

            const user = {id: found.id, username: found.username, email: found.email}
            const tokens = await issueTokenPair(JWT, user)
            await recordAuditLog({
                userId: found.id,
                action: 'auth.login',
                resourceType: 'user',
                resourceId: found.id,
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
        // @ts-ignore - Elysia body type inference
        async ({body, JWT, request}) => {
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
        // @ts-ignore - Elysia body type inference
        async ({body, JWT, request}) => {
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
