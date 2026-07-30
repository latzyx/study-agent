import {readdir, readFile} from 'node:fs/promises'
import path from 'node:path'

export const MIGRATION_DIRECTORY = path.resolve('src/db/migrations')
export const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/

export interface MigrationFile {
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
