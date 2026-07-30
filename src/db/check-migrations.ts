import {loadMigrationFiles} from './migration-files.js'

const migrations = await loadMigrationFiles()
if (migrations.length === 0) throw new Error('No SQL migration files found')

for (const migration of migrations) {
    console.log(`[db:check] ${migration.filename} ${migration.checksum}`)
}

console.log(`[db:check] ${migrations.length} migration file(s) valid`)
