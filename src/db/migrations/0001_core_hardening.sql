do $$
begin
    create type message_role as enum ('user', 'assistant', 'system', 'tool');
exception
    when duplicate_object then null;
end $$;

do $$
begin
    create type model_profile as enum ('fast', 'general', 'reasoning', 'vision');
exception
    when duplicate_object then null;
end $$;

create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    username varchar(50) not null unique,
    email varchar(100) not null unique,
    password_hash varchar(255) not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists agents (
    id uuid primary key default gen_random_uuid(),
    name varchar(100) not null,
    description text,
    system_prompt text,
    model_profile model_profile not null default 'general',
    max_steps integer not null default 5,
    tools jsonb not null default '[]'::jsonb,
    created_by uuid not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists conversations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    agent_id uuid not null,
    session_id varchar(100) not null,
    created_at timestamptz not null default now()
);

create table if not exists messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null,
    role message_role not null,
    content text,
    tool_calls jsonb,
    created_at timestamptz not null default now()
);

create table if not exists audit_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid,
    action varchar(50) not null,
    resource_type varchar(50),
    resource_id uuid,
    details jsonb,
    ip_address varchar(45),
    created_at timestamptz not null default now()
);

create table if not exists operation_logs (
    id uuid primary key default gen_random_uuid(),
    request_id varchar(100) not null,
    user_id uuid,
    method varchar(10) not null,
    path varchar(255) not null,
    status_code integer not null,
    duration_ms integer not null,
    ip_address varchar(45),
    user_agent varchar(500),
    created_at timestamptz not null default now()
);

create table if not exists files (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    filename varchar(255) not null,
    storage_path varchar(500) not null,
    mime_type varchar(100),
    size bigint not null,
    created_at timestamptz not null default now()
);

create table if not exists refresh_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    token_hash varchar(64) not null,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);

alter table operation_logs add column if not exists request_id varchar(100);
alter table operation_logs add column if not exists ip_address varchar(45);
alter table operation_logs add column if not exists user_agent varchar(500);

update agents set tools = '[]'::jsonb where tools is null;
update operation_logs set request_id = 'legacy-' || id::text where request_id is null;
update operation_logs set status_code = 200 where status_code is null;
update operation_logs set duration_ms = 0 where duration_ms is null;
update files set size = 0 where size is null;

do $$
begin
    if exists (select 1 from agents where created_by is null) then
        raise exception 'Migration blocked: agents.created_by contains null values';
    end if;
    if exists (select 1 from agents where max_steps not between 1 and 50) then
        raise exception 'Migration blocked: agents.max_steps contains values outside 1..50';
    end if;
    if exists (select 1 from agents where jsonb_typeof(tools) <> 'array') then
        raise exception 'Migration blocked: agents.tools contains non-array JSON';
    end if;
    if exists (select 1 from conversations where agent_id is null) then
        raise exception 'Migration blocked: conversations.agent_id contains null values';
    end if;
    if exists (
        select 1 from conversations
        group by user_id, session_id
        having count(*) > 1
    ) then
        raise exception 'Migration blocked: duplicate conversations for user_id/session_id';
    end if;
    if exists (select 1 from messages where content is null and tool_calls is null) then
        raise exception 'Migration blocked: messages contain neither content nor tool_calls';
    end if;
    if exists (select 1 from files where user_id is null) then
        raise exception 'Migration blocked: files.user_id contains null values';
    end if;
    if exists (select 1 from files where size < 0) then
        raise exception 'Migration blocked: files.size contains negative values';
    end if;
    if exists (
        select 1 from files
        group by storage_path
        having count(*) > 1
    ) then
        raise exception 'Migration blocked: files.storage_path contains duplicates';
    end if;
    if exists (select 1 from operation_logs where status_code not between 100 and 599) then
        raise exception 'Migration blocked: operation_logs.status_code is outside 100..599';
    end if;
    if exists (select 1 from operation_logs where duration_ms < 0) then
        raise exception 'Migration blocked: operation_logs.duration_ms contains negative values';
    end if;
end $$;

do $$
declare
    column_record record;
    source_timezone text := current_setting('TimeZone');
begin
    for column_record in
        select * from (values
            ('users', 'created_at'),
            ('users', 'updated_at'),
            ('agents', 'created_at'),
            ('agents', 'updated_at'),
            ('conversations', 'created_at'),
            ('messages', 'created_at'),
            ('audit_logs', 'created_at'),
            ('operation_logs', 'created_at'),
            ('files', 'created_at'),
            ('refresh_tokens', 'expires_at'),
            ('refresh_tokens', 'revoked_at'),
            ('refresh_tokens', 'created_at')
        ) as columns_to_convert(table_name, column_name)
    loop
        if exists (
            select 1
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = column_record.table_name
              and column_name = column_record.column_name
              and data_type = 'timestamp without time zone'
        ) then
            execute format(
                'alter table %I alter column %I type timestamptz using %I at time zone %L',
                column_record.table_name,
                column_record.column_name,
                column_record.column_name,
                source_timezone
            );
        end if;
    end loop;
end $$;

alter table agents alter column tools set default '[]'::jsonb;
alter table agents alter column tools set not null;
alter table agents alter column created_by set not null;
alter table conversations alter column agent_id set not null;
alter table files alter column user_id set not null;
alter table files alter column size set not null;
alter table operation_logs alter column request_id set not null;
alter table operation_logs alter column status_code set not null;
alter table operation_logs alter column duration_ms set not null;

do $$
declare
    constraint_record record;
begin
    for constraint_record in
        select c.conname
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
        where c.contype = 'f'
          and n.nspname = current_schema()
          and t.relname = 'agents'
          and a.attname = 'created_by'
    loop
        execute format('alter table agents drop constraint %I', constraint_record.conname);
    end loop;
    alter table agents
        add constraint agents_created_by_users_id_fk
        foreign key (created_by) references users(id) on delete cascade;

    for constraint_record in
        select c.conname
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
        where c.contype = 'f'
          and n.nspname = current_schema()
          and t.relname = 'conversations'
          and a.attname = 'agent_id'
    loop
        execute format('alter table conversations drop constraint %I', constraint_record.conname);
    end loop;
    alter table conversations
        add constraint conversations_agent_id_agents_id_fk
        foreign key (agent_id) references agents(id) on delete cascade;

    for constraint_record in
        select c.conname
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
        where c.contype = 'f'
          and n.nspname = current_schema()
          and t.relname = 'files'
          and a.attname = 'user_id'
    loop
        execute format('alter table files drop constraint %I', constraint_record.conname);
    end loop;
    alter table files
        add constraint files_user_id_users_id_fk
        foreign key (user_id) references users(id) on delete cascade;
end $$;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'conversations_user_id_users_id_fk') then
        alter table conversations
            add constraint conversations_user_id_users_id_fk
            foreign key (user_id) references users(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'messages_conversation_id_conversations_id_fk') then
        alter table messages
            add constraint messages_conversation_id_conversations_id_fk
            foreign key (conversation_id) references conversations(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'audit_logs_user_id_users_id_fk') then
        alter table audit_logs
            add constraint audit_logs_user_id_users_id_fk
            foreign key (user_id) references users(id) on delete set null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'operation_logs_user_id_users_id_fk') then
        alter table operation_logs
            add constraint operation_logs_user_id_users_id_fk
            foreign key (user_id) references users(id) on delete set null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'refresh_tokens_user_id_users_id_fk') then
        alter table refresh_tokens
            add constraint refresh_tokens_user_id_users_id_fk
            foreign key (user_id) references users(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'refresh_tokens_token_hash_unique') then
        alter table refresh_tokens
            add constraint refresh_tokens_token_hash_unique unique (token_hash);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'files_storage_path_unique') then
        alter table files
            add constraint files_storage_path_unique unique (storage_path);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'agents_max_steps_check') then
        alter table agents
            add constraint agents_max_steps_check check (max_steps between 1 and 50);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'messages_content_or_tool_calls_check') then
        alter table messages
            add constraint messages_content_or_tool_calls_check
            check (content is not null or tool_calls is not null);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'operation_logs_status_code_check') then
        alter table operation_logs
            add constraint operation_logs_status_code_check check (status_code between 100 and 599);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'operation_logs_duration_check') then
        alter table operation_logs
            add constraint operation_logs_duration_check check (duration_ms >= 0);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'files_size_check') then
        alter table files
            add constraint files_size_check check (size >= 0);
    end if;
end $$;

create index if not exists refresh_tokens_user_expires_at_idx
    on refresh_tokens (user_id, expires_at);
create index if not exists refresh_tokens_active_idx
    on refresh_tokens (user_id, expires_at) where revoked_at is null;
create index if not exists agents_created_by_created_at_idx
    on agents (created_by, created_at);
create unique index if not exists conversations_user_session_uidx
    on conversations (user_id, session_id);
create index if not exists conversations_user_agent_created_at_idx
    on conversations (user_id, agent_id, created_at);
create index if not exists messages_conversation_created_at_idx
    on messages (conversation_id, created_at);
create index if not exists audit_logs_created_at_idx
    on audit_logs (created_at);
create index if not exists audit_logs_user_created_at_idx
    on audit_logs (user_id, created_at);
create index if not exists audit_logs_action_created_at_idx
    on audit_logs (action, created_at);
create index if not exists operation_logs_request_id_idx
    on operation_logs (request_id);
create index if not exists operation_logs_created_at_idx
    on operation_logs (created_at);
create index if not exists operation_logs_user_created_at_idx
    on operation_logs (user_id, created_at);
create index if not exists operation_logs_path_created_at_idx
    on operation_logs (path, created_at);
create index if not exists files_user_created_at_idx
    on files (user_id, created_at);
