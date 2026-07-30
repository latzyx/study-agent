import {describe, expect, test} from 'bun:test'
import {authenticateAccessToken, hasAdminAccess} from '../src/api/middleware/auth.js'

class FakeJwtVerifier {
    constructor(private readonly payload: Record<string, unknown> | false) {}

    async verify(token: string): Promise<Record<string, unknown> | false> {
        return token === 'valid-token' ? this.payload : false
    }
}

describe('authenticateAccessToken', () => {
    test('accepts a case-insensitive Bearer scheme', async () => {
        const payload = await authenticateAccessToken(
            new FakeJwtVerifier({sub: 'user-1', username: 'lazy', type: 'access'}),
            'bEaReR valid-token',
        )

        expect(payload).toEqual({sub: 'user-1', username: 'lazy'})
    })

    test('rejects refresh tokens and malformed headers', async () => {
        const verifier = new FakeJwtVerifier({sub: 'user-1', type: 'refresh'})

        expect(await authenticateAccessToken(verifier, 'Bearer valid-token')).toBeNull()
        expect(await authenticateAccessToken(verifier, 'Basic valid-token')).toBeNull()
        expect(await authenticateAccessToken(verifier, 'Bearer ')).toBeNull()
        expect(await authenticateAccessToken(verifier)).toBeNull()
    })

    test('requires a string subject', async () => {
        const payload = await authenticateAccessToken(
            new FakeJwtVerifier({sub: 123, type: 'access'}),
            'Bearer valid-token',
        )

        expect(payload).toBeNull()
    })
})

describe('hasAdminAccess', () => {
    test('does not grant admin access by default', () => {
        expect(hasAdminAccess({sub: 'unknown-user', username: 'unknown'})).toBe(false)
    })
})
