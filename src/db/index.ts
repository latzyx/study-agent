import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {env, requireDatabaseUrl} from '../config/env.js'
import * as schema from './schema.js'

export const sql = postgres(requireDatabaseUrl(), {
    max: env.database.maxConnections,
    idle_timeout: env.database.idleTimeoutSeconds,
    connect_timeout: env.database.connectTimeoutSeconds,
    connection: {
        application_name: 'study-agent',
    },
})

export const db = drizzle(sql, {schema})

export async function checkDatabaseConnection(): Promise<void> {
    await sql`select 1`
}

export async function closeDatabaseConnection(): Promise<void> {
    await sql.end({timeout: env.database.shutdownTimeoutSeconds})
}
