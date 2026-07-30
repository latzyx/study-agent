import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {env, requireDatabaseUrl} from '../config/env.js'
import * as schema from './schema.js'
import {
    REQUIRED_SCHEMA_MIGRATION,
    REQUIRED_SCHEMA_VERSION,
} from './schema-version.js'

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

export async function checkDatabaseReadiness(): Promise<void> {
    await checkDatabaseConnection()

    const [migrationTable] = await sql<{table_name: string | null}[]>`
        select to_regclass(current_schema() || '.study_agent_schema_migrations')::text as table_name
    `
    if (!migrationTable?.table_name) {
        throw new Error('Database migrations have not been initialized')
    }

    const [required] = await sql<{version: string; filename: string; checksum: string}[]>`
        select version, filename, checksum
        from study_agent_schema_migrations
        where version = ${REQUIRED_SCHEMA_VERSION}
        limit 1
    `
    if (!required) {
        throw new Error(
            `Required database migration is missing: ${REQUIRED_SCHEMA_MIGRATION}`,
        )
    }
    if (required.filename !== REQUIRED_SCHEMA_MIGRATION || required.checksum.length !== 64) {
        throw new Error(`Required database migration record is invalid: ${REQUIRED_SCHEMA_VERSION}`)
    }
}

export async function closeDatabaseConnection(): Promise<void> {
    await sql.end({timeout: env.database.shutdownTimeoutSeconds})
}
