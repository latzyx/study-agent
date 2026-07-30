create table if not exists chat_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    idempotency_key varchar(100) not null,
    request_hash varchar(64) not null,
    agent_id uuid,
    conversation_id uuid,
    session_id varchar(100),
    trace_id varchar(64),
    status varchar(20) not null default 'running',
    result jsonb,
    error_code varchar(100),
    error_message text,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint chat_requests_user_id_users_id_fk
        foreign key (user_id) references users(id) on delete cascade,
    constraint chat_requests_agent_id_agents_id_fk
        foreign key (agent_id) references agents(id) on delete set null,
    constraint chat_requests_conversation_id_conversations_id_fk
        foreign key (conversation_id) references conversations(id) on delete set null,
    constraint chat_requests_status_check
        check (status in ('running', 'success', 'error', 'aborted'))
);

create unique index if not exists chat_requests_user_key_uidx
    on chat_requests (user_id, idempotency_key);
create index if not exists chat_requests_status_updated_at_idx
    on chat_requests (status, updated_at);
create index if not exists chat_requests_trace_id_idx
    on chat_requests (trace_id);
