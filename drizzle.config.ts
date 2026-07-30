import {defineConfig} from 'drizzle-kit'
import {requireDatabaseUrl} from './src/config/env.js'

export default defineConfig({
    schema: './src/db/schema.ts',
    out: './src/db/migrations',
    dialect: 'postgresql',
    dbCredentials: {
        url: requireDatabaseUrl(),
    },
    strict: true,
    verbose: true,
})
