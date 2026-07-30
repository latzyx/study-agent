import {closeDatabaseConnection, sql} from './index.js'

const REQUIRED_TABLES = [
    'users',
    'refresh_tokens',
    'agents',
    'agent_versions',
    'conversations',
    'messages',
    'ai_runs',
    'ai_spans',
    'audit_logs',
    'operation_logs',
    'files',
    'study_agent_schema_migrations',
]

const REQUIRED_NOT_NULL_COLUMNS = [
    'agents.tools',
    'agents.version',
    'agents.created_by',
    'agent_versions.agent_id',
    'agent_versions.version',
    'agent_versions.snapshot',
    'ai_runs.trace_id',
    'ai_runs.function_id',
    'ai_runs.status',
    'ai_runs.step_count',
    'ai_runs.tool_call_count',
    'ai_spans.run_id',
    'ai_spans.span_key',
    'ai_spans.kind',
    'ai_spans.name',
    'ai_spans.status',
    'conversations.agent_id',
    'files.user_id',
    'files.size',
    'operation_logs.request_id',
    'operation_logs.status_code',
    'operation_logs.duration_ms',
]

const REQUIRED_CONSTRAINTS = [
    'agents_created_by_users_id_fk',
    'agents_version_check',
    'agent_versions_agent_id_agents_id_fk',
    'agent_versions_changed_by_users_id_fk',
    'agent_versions_version_check',
    'agent_versions_change_type_check',
    'ai_runs_trace_id_unique',
    'ai_runs_user_id_users_id_fk',
    'ai_runs_agent_id_agents_id_fk',
    'ai_runs_conversation_id_conversations_id_fk',
    'ai_runs_status_check',
    'ai_runs_duration_check',
    'ai_runs_step_count_check',
    'ai_runs_tool_call_count_check',
    'ai_spans_run_id_ai_runs_id_fk',
    'ai_spans_kind_check',
    'ai_spans_status_check',
    'ai_spans_duration_check',
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
    'agent_versions_agent_version_uidx',
    'agent_versions_agent_created_at_idx',
    'ai_runs_user_created_at_idx',
    'ai_runs_agent_created_at_idx',
    'ai_runs_conversation_created_at_idx',
    'ai_runs_request_id_idx',
    'ai_runs_status_created_at_idx',
    'ai_spans_run_span_key_uidx',
    'ai_spans_run_started_at_idx',
    'ai_spans_kind_status_idx',
    'ai_spans_tool_call_id_idx',
    'conversations_user_session_uidx',
    'conversations_user_agent_created_at_idx',
    'messages_conversation_created_at_idx',
    'audit_logs_user_created_at_idx',
    'operation_logs_request_id_idx',
    'operation_logs_user_created_at_idx',
    'files_user_created_at_idx',
]

const REQUIRED_TRIGGERS = [
    'ai_runs_finalize_spans_trigger',
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

    const triggerRows = await sql<{trigger_name: string}[]>`
        select trigger_name
        from information_schema.triggers
        where trigger_schema = current_schema()
    `
    assertPresent(
        'triggers',
        REQUIRED_TRIGGERS,
        new Set(triggerRows.map((row) => row.trigger_name)),
    )

    const [migrationCount] = await sql<{count: number}[]>`
        select count(*)::int as count from study_agent_schema_migrations
    `
    if ((migrationCount?.count ?? 0) < 3) {
        throw new Error('Expected at least three applied migration records')
    }

    console.log('[db:verify] migrated schema verified')
}

try {
    await verify()
} finally {
    await closeDatabaseConnection()
}
