import {eq} from 'drizzle-orm'
import {createApiError} from '../api/errors/api-error.js'
import {db} from '../db/index.js'
import {users} from '../db/schema.js'
import type {TokenUser} from './token-service.js'

const dummyPasswordHash = Bun.password.hash(
    'study-agent-invalid-password-placeholder',
)

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase()
}

function normalizeUsername(username: string): string {
    return username.trim()
}

export async function registerUser(input: {
    username: string
    email: string
    password: string
}): Promise<TokenUser> {
    const username = normalizeUsername(input.username)
    const email = normalizeEmail(input.email)
    const passwordHash = await Bun.password.hash(input.password)

    const [created] = await db.insert(users).values({
        username,
        email,
        passwordHash,
    })
        .onConflictDoNothing()
        .returning({id: users.id, username: users.username, email: users.email})

    if (!created) {
        throw createApiError(
            409,
            'USER_EXISTS',
            'Email or username is already registered',
        )
    }

    return created
}

export async function authenticateUser(emailInput: string, password: string): Promise<TokenUser> {
    const email = normalizeEmail(emailInput)
    const [found] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const passwordHash = found?.passwordHash ?? await dummyPasswordHash
    const validPassword = await Bun.password.verify(password, passwordHash)

    if (!found || !validPassword) {
        throw createApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
    }

    return {
        id: found.id,
        username: found.username,
        email: found.email,
    }
}

export function normalizedLoginEmail(email: string): string {
    return normalizeEmail(email)
}
