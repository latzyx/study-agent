import {sql} from 'drizzle-orm'
import {
    bigint,
    check,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'

export const messageRoleEnum = pgEnum('message_role', [
    'user',
    'assistant',
    'system',
    'tool',
])

export const modelProfileEnum = pgEnum('model_profile', [
    'fast',
    'general',
    'reasoning',
    'vision',
])

const createdAt = () => timestamp('created_at', {withTimezone: true}).defaultNow().notNull()
const updatedAt = () => timestamp('updated_at', {withTimezone: true})
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()

export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', {length: 50}).notNull().unique(),
    email: varchar('email', {length: 100}).notNull().unique(),
    passwordHash: varchar('password_hash', {length: 255}).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
})

export const refreshTokens = pgTable('refresh_tokens', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id, {onDelete: 'cascade'})
        .notNull(),
    tokenHash: varchar('token_hash', {length: 64}).notNull().unique(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
    revokedAt: timestamp('revoked_at', {withTimezone: true}),
    createdAt: createdAt(),
}, (table) => [
    index('refresh_tokens_user_expires_at_idx').on(table.userId, table.expiresAt),
    index('refresh_tokens_active_idx')
        .on(table.userId, table.expiresAt)
        .where(sql`${table.revokedAt} is null`),
])

export const agents = pgTable('agents', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', {length: 100}).notNull(),
    description: text('description'),
    systemPrompt: text('system_prompt'),
    modelProfile: modelProfileEnum('model_profile').default('general').notNull(),
    maxSteps: integer('max_steps').default(5).notNull(),
    tools: jsonb('tools').$type<string[]>().default([]).notNull(),
    version: integer('version').default(1).notNull(),
    createdBy: uuid('created_by')
        .references(() => users.id, {onDelete: 'cascade'})
        .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
}, (table) => [
    index('agents_created_by_created_at_idx').on(table.createdBy, table.createdAt),
    check('agents_max_steps_check', sql`${table.maxSteps} between 1 and 50`),
    check('agents_version_check', sql`${table.version} >= 1`),
])

export const agentVersions = pgTable('agent_versions', {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
        .references(() => agents.id, {onDelete: 'cascade'})
        .notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    changeType: varchar('change_type', {length: 20}).notNull(),
    sourceVersion: integer('source_version'),
    changedBy: uuid('changed_by').references(() => users.id, {onDelete: 'set null'}),
    requestId: varchar('request_id', {length: 100}),
    createdAt: createdAt(),
}, (table) => [
    uniqueIndex('agent_versions_agent_version_uidx').on(table.agentId, table.version),
    index('agent_versions_agent_created_at_idx').on(table.agentId, table.createdAt),
    check('agent_versions_version_check', sql`${table.version} >= 1`),
    check(
        'agent_versions_change_type_check',
        sql`${table.changeType} in ('create', 'update', 'rollback')`,
    ),
])

export const conversations = pgTable('conversations', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id, {onDelete: 'cascade'})
        .notNull(),
    agentId: uuid('agent_id')
        .references(() => agents.id, {onDelete: 'cascade'})
        .notNull(),
    sessionId: varchar('session_id', {length: 100}).notNull(),
    createdAt: createdAt(),
}, (table) => [
    uniqueIndex('conversations_user_session_uidx').on(table.userId, table.sessionId),
    index('conversations_user_agent_created_at_idx').on(
        table.userId,
        table.agentId,
        table.createdAt,
    ),
])

export const messages = pgTable('messages', {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
        .references(() => conversations.id, {onDelete: 'cascade'})
        .notNull(),
    role: messageRoleEnum('role').notNull(),
    content: text('content'),
    toolCalls: jsonb('tool_calls'),
    createdAt: createdAt(),
}, (table) => [
    index('messages_conversation_created_at_idx').on(table.conversationId, table.createdAt),
    check(
        'messages_content_or_tool_calls_check',
        sql`${table.content} is not null or ${table.toolCalls} is not null`,
    ),
])

export const aiRuns = pgTable('ai_runs', {
    id: uuid('id').defaultRandom().primaryKey(),
    traceId: varchar('trace_id', {length: 64}).notNull().unique(),
    requestId: varchar('request_id', {length: 100}),
    userId: uuid('user_id').references(() => users.id, {onDelete: 'set null'}),
    agentId: uuid('agent_id').references(() => agents.id, {onDelete: 'set null'}),
    conversationId: uuid('conversation_id')
        .references(() => conversations.id, {onDelete: 'set null'}),
    sessionId: varchar('session_id', {length: 100}),
    functionId: varchar('function_id', {length: 100}).notNull(),
    status: varchar('status', {length: 20}).default('running').notNull(),
    modelProvider: varchar('model_provider', {length: 100}),
    modelId: varchar('model_id', {length: 255}),
    inputSnapshot: jsonb('input_snapshot'),
    outputSnapshot: jsonb('output_snapshot'),
    metadata: jsonb('metadata'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    stepCount: integer('step_count').default(0).notNull(),
    toolCallCount: integer('tool_call_count').default(0).notNull(),
    errorName: varchar('error_name', {length: 255}),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', {withTimezone: true}).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
}, (table) => [
    index('ai_runs_user_created_at_idx').on(table.userId, table.createdAt),
    index('ai_runs_agent_created_at_idx').on(table.agentId, table.createdAt),
    index('ai_runs_conversation_created_at_idx').on(table.conversationId, table.createdAt),
    index('ai_runs_request_id_idx').on(table.requestId),
    index('ai_runs_status_created_at_idx').on(table.status, table.createdAt),
    check(
        'ai_runs_status_check',
        sql`${table.status} in ('running', 'success', 'error', 'aborted')`,
    ),
    check('ai_runs_duration_check', sql`${table.durationMs} is null or ${table.durationMs} >= 0`),
    check('ai_runs_step_count_check', sql`${table.stepCount} >= 0`),
    check('ai_runs_tool_call_count_check', sql`${table.toolCallCount} >= 0`),
])

export const aiSpans = pgTable('ai_spans', {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
        .references(() => aiRuns.id, {onDelete: 'cascade'})
        .notNull(),
    spanKey: varchar('span_key', {length: 255}).notNull(),
    parentSpanKey: varchar('parent_span_key', {length: 255}),
    kind: varchar('kind', {length: 20}).notNull(),
    name: varchar('name', {length: 255}).notNull(),
    status: varchar('status', {length: 20}).default('running').notNull(),
    stepNumber: integer('step_number'),
    toolCallId: varchar('tool_call_id', {length: 255}),
    modelProvider: varchar('model_provider', {length: 100}),
    modelId: varchar('model_id', {length: 255}),
    inputSnapshot: jsonb('input_snapshot'),
    outputSnapshot: jsonb('output_snapshot'),
    metadata: jsonb('metadata'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens'),
    finishReason: varchar('finish_reason', {length: 100}),
    errorName: varchar('error_name', {length: 255}),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', {withTimezone: true}).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', {withTimezone: true}),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
}, (table) => [
    uniqueIndex('ai_spans_run_span_key_uidx').on(table.runId, table.spanKey),
    index('ai_spans_run_started_at_idx').on(table.runId, table.startedAt),
    index('ai_spans_kind_status_idx').on(table.kind, table.status),
    index('ai_spans_tool_call_id_idx').on(table.toolCallId),
    check(
        'ai_spans_kind_check',
        sql`${table.kind} in ('generation', 'step', 'tool')`,
    ),
    check(
        'ai_spans_status_check',
        sql`${table.status} in ('running', 'success', 'error', 'aborted')`,
    ),
    check('ai_spans_duration_check', sql`${table.durationMs} is null or ${table.durationMs} >= 0`),
])

export const auditLogs = pgTable('audit_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, {onDelete: 'set null'}),
    action: varchar('action', {length: 50}).notNull(),
    resourceType: varchar('resource_type', {length: 50}),
    resourceId: uuid('resource_id'),
    details: jsonb('details'),
    ipAddress: varchar('ip_address', {length: 45}),
    createdAt: createdAt(),
}, (table) => [
    index('audit_logs_created_at_idx').on(table.createdAt),
    index('audit_logs_user_created_at_idx').on(table.userId, table.createdAt),
    index('audit_logs_action_created_at_idx').on(table.action, table.createdAt),
])

export const operationLogs = pgTable('operation_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    requestId: varchar('request_id', {length: 100}).notNull(),
    userId: uuid('user_id').references(() => users.id, {onDelete: 'set null'}),
    method: varchar('method', {length: 10}).notNull(),
    path: varchar('path', {length: 255}).notNull(),
    statusCode: integer('status_code').notNull(),
    durationMs: integer('duration_ms').notNull(),
    ipAddress: varchar('ip_address', {length: 45}),
    userAgent: varchar('user_agent', {length: 500}),
    createdAt: createdAt(),
}, (table) => [
    index('operation_logs_request_id_idx').on(table.requestId),
    index('operation_logs_created_at_idx').on(table.createdAt),
    index('operation_logs_user_created_at_idx').on(table.userId, table.createdAt),
    index('operation_logs_path_created_at_idx').on(table.path, table.createdAt),
    check('operation_logs_status_code_check', sql`${table.statusCode} between 100 and 599`),
    check('operation_logs_duration_check', sql`${table.durationMs} >= 0`),
])

export const files = pgTable('files', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id, {onDelete: 'cascade'})
        .notNull(),
    filename: varchar('filename', {length: 255}).notNull(),
    storagePath: varchar('storage_path', {length: 500}).notNull().unique(),
    mimeType: varchar('mime_type', {length: 100}),
    size: bigint('size', {mode: 'number'}).notNull(),
    createdAt: createdAt(),
}, (table) => [
    index('files_user_created_at_idx').on(table.userId, table.createdAt),
    check('files_size_check', sql`${table.size} >= 0`),
])
