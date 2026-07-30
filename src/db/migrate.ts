import {readdir, readFile} from 'node:fs/promises'
import path from 'node:path'
import {closeDatabaseConnection, sql} from './index.js'

const MIGRATION_DIRECTORY = path.resolve('src/db/migrations')
const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/
const MIGRATION_LOCK_ID = 7_310_426_001

interface MigrationFile {
    version: string
    filename: string
    checksum: string
    content: string
}

async function sha256(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function loadMigrationFiles(directory = MIGRATION_DIRECTORY): Promise<MigrationFile[]> {
    const filenames = (await readdir(directory))
        .filter((filename) => filename.endsWith('.sql'))
        .sort()

    const invalid = filenames.filter((filename) => !MIGRATION_FILE_PATTERN.test(filename))
    if (invalid.length > 0) {
        throw new Error(`Invalid migration filenames: ${invalid.join(', ')}`)
    }

    const migrations = await Promise.all(filenames.map(async (filename) => {
        const content = await readFile(path.join(directory, filename), 'utf8')
        if (!content.trim()) throw new Error(`Migration ${filename} is empty`)

        return {
            version: filename.slice(0, 4),
            filename,
            content,
            checksum: await sha256(content),
        }
    }))

    const duplicateVersions = migrations
        .map((migration) => migration.version)
        .filter((version, index, versions) => versions.indexOf(version) !== index)
    if (duplicateVersions.length > 0) {
        throw new Error(`Duplicate migration versions: ${[...new Set(duplicateVersions)].join(', ')}`)
    }

    return migrations
}

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
