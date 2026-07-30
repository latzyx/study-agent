import {Elysia} from 'elysia'
import {eq, or} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {users} from '../../db/schema.js'
import {registerBody, loginBody, refreshBody} from '../schemas/auth.js'
import {authPlugin} from '../middleware/auth.js'

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

function errorResponse(status: number, code: string, message: string): Response {
    return Response.json({success: false, error: {code, message}}, {status})
}

function setAuthCookie(auth: any, token: string): void {
    if (!auth) return

    auth.set({
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: ACCESS_TOKEN_TTL_SECONDS,
    })
}

async function createTokens(
    JWT: {sign(payload: Record<string, unknown>): Promise<string>},
    user: {id: string; username: string},
) {
    const now = Math.floor(Date.now() / 1000)
    const token = await JWT.sign({
        sub: user.id,
        username: user.username,
        type: 'access',
        iat: now,
        exp: now + ACCESS_TOKEN_TTL_SECONDS,
    })
    const refreshToken = await JWT.sign({
        sub: user.id,
        type: 'refresh',
        iat: now,
        exp: now + REFRESH_TOKEN_TTL_SECONDS,
    })

    return {token, refreshToken}
}

export const authRoutes = new Elysia({prefix: '/auth'})
    .use(authPlugin)
    .post(
        '/register',
        // @ts-ignore - Elysia body type inference
        async ({body, JWT, cookie: {auth}}) => {
            const email = body.email.trim().toLowerCase()
            const username = body.username.trim()
            const [existing] = await db.select({id: users.id}).from(users)
                .where(or(eq(users.email, email), eq(users.username, username)))
                .limit(1)

            if (existing) {
                return errorResponse(409, 'USER_EXISTS', 'Email or username is already registered')
            }

            const passwordHash = await Bun.password.hash(body.password)
            const [newUser] = await db.insert(users).values({
                username,
                email,
                passwordHash,
            }).returning({id: users.id, username: users.username, email: users.email})

            if (!newUser) return errorResponse(500, 'CREATE_FAILED', 'Failed to create user')

            const {token, refreshToken} = await createTokens(JWT, newUser)
            setAuthCookie(auth, token)

            return {
                success: true,
                data: {
                    user: {id: newUser.id, username: newUser.username, email: newUser.email},
                    token,
                    refreshToken,
                },
            }
        },
        {body: registerBody, detail: {summary: 'Register a new user'}},
    )
    .post(
        '/login',
        // @ts-ignore - Elysia body type inference
        async ({body, JWT, cookie: {auth}}) => {
            const email = body.email.trim().toLowerCase()
            const [found] = await db.select().from(users).where(eq(users.email, email)).limit(1)
            if (!found || !(await Bun.password.verify(body.password, found.passwordHash))) {
                return errorResponse(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
            }

            const {token, refreshToken} = await createTokens(JWT, found)
            setAuthCookie(auth, token)

            return {
                success: true,
                data: {
                    user: {id: found.id, username: found.username, email: found.email},
                    token,
                    refreshToken,
                },
            }
        },
        {body: loginBody, detail: {summary: 'Login with email and password'}},
    )
    .post(
        '/refresh',
        // @ts-ignore - Elysia body type inference
        async ({body, JWT, cookie: {auth}}) => {
            const payload = await JWT.verify(body.token)
            if (!payload || payload.type !== 'refresh' || typeof payload.sub !== 'string') {
                return errorResponse(401, 'INVALID_TOKEN', 'Invalid refresh token')
            }

            const [found] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1)
            if (!found) return errorResponse(401, 'USER_NOT_FOUND', 'User not found')

            const {token, refreshToken} = await createTokens(JWT, found)
            setAuthCookie(auth, token)

            return {
                success: true,
                data: {
                    user: {id: found.id, username: found.username, email: found.email},
                    token,
                    refreshToken,
                },
            }
        },
        {body: refreshBody, detail: {summary: 'Refresh access token'}},
    )
