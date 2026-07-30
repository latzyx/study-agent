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

export const agents = pgTable('agents', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', {length: 100}).notNull(),
    description: text('description'),
    systemPrompt: text('system_prompt'),
    modelProfile: modelProfileEnum('model_profile').default('general').notNull(),
    maxSteps: integer('max_steps').default(5).notNull(),
    tools: jsonb('tools').$type<string[]>().default([]).notNull(),
    createdBy: uuid('created_by')
        .references(() => users.id, {onDelete: 'cascade'})
        .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
}, (table) => [
    index('agents_created_by_created_at_idx').on(table.createdBy, table.createdAt),
    check('agents_max_steps_check', sql`${table.maxSteps} between 1 and 50`),
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
    userId: uuid('user_id').references(() => users.id, {onDelete: 'set null'}),
    method: varchar('method', {length: 10}).notNull(),
    path: varchar('path', {length: 255}).notNull(),
    statusCode: integer('status_code').notNull(),
    durationMs: integer('duration_ms').notNull(),
    createdAt: createdAt(),
}, (table) => [
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
