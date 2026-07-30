import {Elysia, t} from 'elysia'
import {eq} from 'drizzle-orm'
import {db} from '../../db/index.js'
import {users} from '../../db/schema.js'
import {registerBody, loginBody, refreshBody, authResponse} from '../schemas/auth.js'
import {errorResponse} from '../schemas/common.js'
import {authPlugin} from '../middleware/auth.js'

export const authRoutes = new Elysia({prefix: '/auth'})
    .use(authPlugin)
    .post(
        '/register',
        // @ts-ignore - Elysia body type inference
        async ({body, JWT, cookie: {auth}}) => {
            const existing = await db.select().from(users)
                .where(eq(users.email, body.email) || eq(users.username, body.username)).limit(1)

            if (existing.length > 0) {
                return new Response(JSON.stringify({success: false, error: {code: 'USER_EXISTS', message: 'User already exists'}}), {status: 409, headers: {'Content-Type': 'application/json'}})
            }

            const passwordHash = await Bun.password.hash(body.password)
            const [newUser] = await db.insert(users).values({username: body.username, email: body.email, passwordHash}).returning({id: users.id, username: users.username, email: users.email})
            if (!newUser) return new Response(JSON.stringify({success: false, error: {code: 'CREATE_FAILED', message: 'Failed'}}), {status: 500, headers: {'Content-Type': 'application/json'}})

            const token = await JWT.sign({sub: newUser.id, username: newUser.username})
            const refreshToken = await JWT.sign({sub: newUser.id, type: 'refresh'})
            if (auth) auth.set({value: token, httpOnly: true, maxAge: 7 * 24 * 60 * 60})

            return {success: true, data: {user: {id: newUser.id, username: newUser.username, email: newUser.email}, token, refreshToken}}
        },
        {body: registerBody, detail: {summary: 'Register a new user'}},
    )
    .post(
        '/login',
        // @ts-ignore
        async ({body, JWT, cookie: {auth}}) => {
            const [found] = await db.select().from(users).where(eq(users.email, body.email)).limit(1)
            if (!found || !(await Bun.password.verify(body.password, found.passwordHash))) {
                return new Response(JSON.stringify({success: false, error: {code: 'INVALID_CREDENTIALS', message: 'Invalid email or password'}}), {status: 401, headers: {'Content-Type': 'application/json'}})
            }

            const token = await JWT.sign({sub: found.id, username: found.username})
            const refreshToken = await JWT.sign({sub: found.id, type: 'refresh'})
            if (auth) auth.set({value: token, httpOnly: true, maxAge: 7 * 24 * 60 * 60})

            return {success: true, data: {user: {id: found.id, username: found.username, email: found.email}, token, refreshToken}}
        },
        {body: loginBody, detail: {summary: 'Login with email and password'}},
    )
    .post(
        '/refresh',
        // @ts-ignore
        async ({body, JWT}) => {
            const payload = await JWT.verify(body.token)
            if (!payload || payload.type !== 'refresh') {
                return new Response(JSON.stringify({success: false, error: {code: 'INVALID_TOKEN', message: 'Invalid refresh token'}}), {status: 401, headers: {'Content-Type': 'application/json'}})
            }

            const [found] = await db.select().from(users).where(eq(users.id, payload.sub as string)).limit(1)
            if (!found) {
                return new Response(JSON.stringify({success: false, error: {code: 'USER_NOT_FOUND', message: 'User not found'}}), {status: 401, headers: {'Content-Type': 'application/json'}})
            }

            const token = await JWT.sign({sub: found.id, username: found.username})
            const refreshToken = await JWT.sign({sub: found.id, type: 'refresh'})

            return {success: true, data: {user: {id: found.id, username: found.username, email: found.email}, token, refreshToken}}
        },
        {body: refreshBody, detail: {summary: 'Refresh access token'}},
    )
