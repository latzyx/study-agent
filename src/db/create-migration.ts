import {writeFile} from 'node:fs/promises'
import path from 'node:path'
import {MIGRATION_DIRECTORY, loadMigrationFiles} from './migration-files.js'

const rawName = process.argv[2]?.trim().toLowerCase()
if (!rawName) {
    throw new Error('Usage: bun run db:generate -- <migration-name>')
}

const slug = rawName
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
if (!slug) throw new Error('Migration name must contain letters or numbers')

const migrations = await loadMigrationFiles()
const latestVersion = migrations.at(-1)?.version ?? '-1'
const nextNumber = Number.parseInt(latestVersion, 10) + 1
if (!Number.isSafeInteger(nextNumber) || nextNumber > 9999) {
    throw new Error('Migration version range exhausted')
}

const version = String(nextNumber).padStart(4, '0')
const filename = `${version}_${slug}.sql`
const filepath = path.join(MIGRATION_DIRECTORY, filename)
const template = `-- ${filename}\n-- Add forward-only PostgreSQL statements below.\n\n`

await writeFile(filepath, template, {encoding: 'utf8', flag: 'wx'})
console.log(`[db:generate] created ${filepath}`)
