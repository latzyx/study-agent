import {closeDatabaseConnection, sql} from './index.js'
import {loadMigrationFiles} from './migration-files.js'

const MIGRATION_LOCK_ID = 7_310_426_001

export async function runMigrations(): Promise<void> {
    const migrations = await loadMigrationFiles()
    if (migrations.length === 0) throw new Error('No SQL migration files found')

    await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`
        await tx.unsafe(`
            create table if not exists study_agent_schema_migrations (
                version varchar(20) primary key,
                filename varchar(255) not null unique,
                checksum varchar(64) not null,
                applied_at timestamptz not null default now()
            )
        `)

        const appliedRows = await tx<{
            version: string
            filename: string
            checksum: string
        }[]>`
            select version, filename, checksum
            from study_agent_schema_migrations
            order by version
        `
        const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row]))

        for (const migration of migrations) {
            const applied = appliedByVersion.get(migration.version)
            if (applied) {
                if (applied.filename !== migration.filename || applied.checksum !== migration.checksum) {
                    throw new Error(
                        `Applied migration ${migration.version} does not match ${migration.filename}; `
                        + 'never edit an applied migration',
                    )
                }
                console.log(`[db:migrate] skip ${migration.filename}`)
                continue
            }

            console.log(`[db:migrate] apply ${migration.filename}`)
            await tx.unsafe(migration.content).simple()
            await tx`
                insert into study_agent_schema_migrations (version, filename, checksum)
                values (${migration.version}, ${migration.filename}, ${migration.checksum})
            `
        }
    })
}

if (import.meta.main) {
    try {
        await runMigrations()
        console.log('[db:migrate] database is up to date')
    } finally {
        await closeDatabaseConnection()
    }
}
