import {Elysia} from 'elysia'
import {jwt} from '@elysiajs/jwt'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

export const authPlugin = new Elysia()
    .use(
        jwt({
            name: 'JWT',
            secret: JWT_SECRET,
        }),
    )

export {JWT_SECRET}
