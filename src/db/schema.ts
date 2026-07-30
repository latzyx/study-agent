import {
    pgTable,
    uuid,
    varchar,
    text,
    integer,
    bigint,
    timestamp,
    jsonb,
    pgEnum,
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

// ── users ──
export const users = pgTable('users', {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', {length: 50}).notNull().unique(),
    email: varchar('email', {length: 100}).notNull().unique(),
    passwordHash: varchar('password_hash', {length: 255}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── agents ──
export const agents = pgTable('agents', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', {length: 100}).notNull(),
    description: text('description'),
    systemPrompt: text('system_prompt'),
    modelProfile: modelProfileEnum('model_profile').default('general').notNull(),
    maxSteps: integer('max_steps').default(5).notNull(),
    tools: jsonb('tools').$type<string[]>().default([]),
    createdBy: uuid('created_by')
        .references(() => users.id, {onDelete: 'set null'}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ── conversations ──
export const conversations = pgTable('conversations', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id, {onDelete: 'cascade'})
        .notNull(),
    agentId: uuid('agent_id')
        .references(() => agents.id, {onDelete: 'set null'}),
    sessionId: varchar('session_id', {length: 100}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── messages ──
export const messages = pgTable('messages', {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
        .references(() => conversations.id, {onDelete: 'cascade'})
        .notNull(),
    role: messageRoleEnum('role').notNull(),
    content: text('content'),
    toolCalls: jsonb('tool_calls'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── audit_logs ──
export const auditLogs = pgTable('audit_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id, {onDelete: 'set null'}),
    action: varchar('action', {length: 50}).notNull(),
    resourceType: varchar('resource_type', {length: 50}),
    resourceId: uuid('resource_id'),
    details: jsonb('details'),
    ipAddress: varchar('ip_address', {length: 45}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── operation_logs ──
export const operationLogs = pgTable('operation_logs', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id, {onDelete: 'set null'}),
    method: varchar('method', {length: 10}).notNull(),
    path: varchar('path', {length: 255}).notNull(),
    statusCode: integer('status_code'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ── files ──
export const files = pgTable('files', {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
        .references(() => users.id, {onDelete: 'set null'}),
    filename: varchar('filename', {length: 255}).notNull(),
    storagePath: varchar('storage_path', {length: 500}).notNull(),
    mimeType: varchar('mime_type', {length: 100}),
    size: bigint('size', {mode: 'number'}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
})
