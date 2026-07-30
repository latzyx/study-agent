import {closeDatabaseConnection, sql} from './index.js'

const REQUIRED_TABLES = [
    'users',
    'refresh_tokens',
    'agents',
    'conversations',
    'messages',
    'audit_logs',
    'operation_logs',
    'files',
    'study_agent_schema_migrations',
]

const REQUIRED_NOT_NULL_COLUMNS = [
    'agents.tools',
    'agents.created_by',
    'conversations.agent_id',
    'files.user_id',
    'files.size',
    'operation_logs.request_id',
    'operation_logs.status_code',
    'operation_logs.duration_ms',
]

const REQUIRED_CONSTRAINTS = [
    'agents_created_by_users_id_fk',
    'conversations_agent_id_agents_id_fk',
    'files_user_id_users_id_fk',
    'refresh_tokens_user_id_users_id_fk',
    'refresh_tokens_token_hash_unique',
    'files_storage_path_unique',
    'agents_max_steps_check',
    'messages_content_or_tool_calls_check',
    'operation_logs_status_code_check',
    'operation_logs_duration_check',
    'files_size_check',
]

const REQUIRED_INDEXES = [
    'refresh_tokens_user_expires_at_idx',
    'refresh_tokens_active_idx',
    'agents_created_by_created_at_idx',
    'conversations_user_session_uidx',
    'conversations_user_agent_created_at_idx',
    'messages_conversation_created_at_idx',
    'audit_logs_user_created_at_idx',
    'operation_logs_request_id_idx',
    'operation_logs_user_created_at_idx',
    'files_user_created_at_idx',
]

function assertPresent(kind: string, expected: readonly string[], actual: Set<string>): void {
    const missing = expected.filter((name) => !actual.has(name))
    if (missing.length > 0) throw new Error(`Missing ${kind}: ${missing.join(', ')}`)
}

async function verify(): Promise<void> {
    const tableRows = await sql<{table_name: string}[]>`
        select table_name
        from information_schema.tables
        where table_schema = current_schema()
    `
    assertPresent('tables', REQUIRED_TABLES, new Set(tableRows.map((row) => row.table_name)))

    const columnRows = await sql<{
        table_name: string
        column_name: string
        is_nullable: 'YES' | 'NO'
        data_type: string
    }[]>`
        select table_name, column_name, is_nullable, data_type
        from information_schema.columns
        where table_schema = current_schema()
    `
    const columns = new Map(columnRows.map((row) => [`${row.table_name}.${row.column_name}`, row]))

    for (const name of REQUIRED_NOT_NULL_COLUMNS) {
        const column = columns.get(name)
        if (!column) throw new Error(`Missing column: ${name}`)
        if (column.is_nullable !== 'NO') throw new Error(`Column must be NOT NULL: ${name}`)
    }

    for (const row of columnRows.filter((column) => column.column_name.endsWith('_at'))) {
        if (row.data_type !== 'timestamp with time zone') {
            throw new Error(`${row.table_name}.${row.column_name} must use timestamptz`)
        }
    }

    const constraintRows = await sql<{conname: string}[]>`
        select conname
        from pg_constraint
        where connamespace = current_schema()::regnamespace
    `
    assertPresent(
        'constraints',
        REQUIRED_CONSTRAINTS,
        new Set(constraintRows.map((row) => row.conname)),
    )

    const indexRows = await sql<{indexname: string}[]>`
        select indexname
        from pg_indexes
        where schemaname = current_schema()
    `
    assertPresent('indexes', REQUIRED_INDEXES, new Set(indexRows.map((row) => row.indexname)))

    const [migrationCount] = await sql<{count: number}[]>`
        select count(*)::int as count from study_agent_schema_migrations
    `
    if ((migrationCount?.count ?? 0) < 1) throw new Error('No applied migration records found')

    console.log('[db:verify] migrated schema verified')
}

try {
    await verify()
} finally {
    await closeDatabaseConnection()
}
