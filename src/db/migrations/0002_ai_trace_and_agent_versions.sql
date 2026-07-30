alter table agents add column if not exists version integer;
update agents set version = 1 where version is null;
alter table agents alter column version set default 1;
alter table agents alter column version set not null;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'agents_version_check') then
        alter table agents
            add constraint agents_version_check check (version >= 1);
    end if;
end $$;

create table if not exists agent_versions (
    id uuid primary key default gen_random_uuid(),
    agent_id uuid not null,
    version integer not null,
    snapshot jsonb not null,
    change_type varchar(20) not null,
    source_version integer,
    changed_by uuid,
    request_id varchar(100),
    created_at timestamptz not null default now()
);

create table if not exists ai_runs (
    id uuid primary key default gen_random_uuid(),
    trace_id varchar(64) not null,
    request_id varchar(100),
    user_id uuid,
    agent_id uuid,
    conversation_id uuid,
    session_id varchar(100),
    function_id varchar(100) not null,
    status varchar(20) not null default 'running',
    model_provider varchar(100),
    model_id varchar(255),
    input_snapshot jsonb,
    output_snapshot jsonb,
    metadata jsonb,
    input_tokens integer,
    output_tokens integer,
    total_tokens integer,
    step_count integer not null default 0,
    tool_call_count integer not null default 0,
    error_name varchar(255),
    error_message text,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    duration_ms integer,
    created_at timestamptz not null default now()
);

create table if not exists ai_spans (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null,
    span_key varchar(255) not null,
    parent_span_key varchar(255),
    kind varchar(20) not null,
    name varchar(255) not null,
    status varchar(20) not null default 'running',
    step_number integer,
    tool_call_id varchar(255),
    model_provider varchar(100),
    model_id varchar(255),
    input_snapshot jsonb,
    output_snapshot jsonb,
    metadata jsonb,
    input_tokens integer,
    output_tokens integer,
    total_tokens integer,
    finish_reason varchar(100),
    error_name varchar(255),
    error_message text,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    duration_ms integer,
    created_at timestamptz not null default now()
);

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'agent_versions_agent_id_agents_id_fk') then
        alter table agent_versions
            add constraint agent_versions_agent_id_agents_id_fk
            foreign key (agent_id) references agents(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'agent_versions_changed_by_users_id_fk') then
        alter table agent_versions
            add constraint agent_versions_changed_by_users_id_fk
            foreign key (changed_by) references users(id) on delete set null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'agent_versions_version_check') then
        alter table agent_versions
            add constraint agent_versions_version_check check (version >= 1);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'agent_versions_change_type_check') then
        alter table agent_versions
            add constraint agent_versions_change_type_check
            check (change_type in ('create', 'update', 'rollback'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'ai_runs_trace_id_unique') then
        alter table ai_runs
            add constraint ai_runs_trace_id_unique unique (trace_id);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_runs_user_id_users_id_fk') then
        alter table ai_runs
            add constraint ai_runs_user_id_users_id_fk
            foreign key (user_id) references users(id) on delete set null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_runs_agent_id_agents_id_fk') then
        alter table ai_runs
            add constraint ai_runs_agent_id_agents_id_fk
            foreign key (agent_id) references agents(id) on delete set null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_runs_conversation_id_conversations_id_fk') then
        alter table ai_runs
            add constraint ai_runs_conversation_id_conversations_id_fk
            foreign key (conversation_id) references conversations(id) on delete set null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_runs_status_check') then
        alter table ai_runs
            add constraint ai_runs_status_check
            check (status in ('running', 'success', 'error', 'aborted'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_runs_duration_check') then
        alter table ai_runs
            add constraint ai_runs_duration_check check (duration_ms is null or duration_ms >= 0);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_runs_step_count_check') then
        alter table ai_runs
            add constraint ai_runs_step_count_check check (step_count >= 0);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_runs_tool_call_count_check') then
        alter table ai_runs
            add constraint ai_runs_tool_call_count_check check (tool_call_count >= 0);
    end if;

    if not exists (select 1 from pg_constraint where conname = 'ai_spans_run_id_ai_runs_id_fk') then
        alter table ai_spans
            add constraint ai_spans_run_id_ai_runs_id_fk
            foreign key (run_id) references ai_runs(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_spans_kind_check') then
        alter table ai_spans
            add constraint ai_spans_kind_check check (kind in ('generation', 'step', 'tool'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_spans_status_check') then
        alter table ai_spans
            add constraint ai_spans_status_check
            check (status in ('running', 'success', 'error', 'aborted'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ai_spans_duration_check') then
        alter table ai_spans
            add constraint ai_spans_duration_check check (duration_ms is null or duration_ms >= 0);
    end if;
end $$;

create unique index if not exists agent_versions_agent_version_uidx
    on agent_versions (agent_id, version);
create index if not exists agent_versions_agent_created_at_idx
    on agent_versions (agent_id, created_at);

create index if not exists ai_runs_user_created_at_idx
    on ai_runs (user_id, created_at);
create index if not exists ai_runs_agent_created_at_idx
    on ai_runs (agent_id, created_at);
create index if not exists ai_runs_conversation_created_at_idx
    on ai_runs (conversation_id, created_at);
create index if not exists ai_runs_request_id_idx
    on ai_runs (request_id);
create index if not exists ai_runs_status_created_at_idx
    on ai_runs (status, created_at);

create unique index if not exists ai_spans_run_span_key_uidx
    on ai_spans (run_id, span_key);
create index if not exists ai_spans_run_started_at_idx
    on ai_spans (run_id, started_at);
create index if not exists ai_spans_kind_status_idx
    on ai_spans (kind, status);
create index if not exists ai_spans_tool_call_id_idx
    on ai_spans (tool_call_id);

insert into agent_versions (
    agent_id,
    version,
    snapshot,
    change_type,
    changed_by,
    created_at
)
select
    id,
    version,
    jsonb_build_object(
        'name', name,
        'description', description,
        'systemPrompt', system_prompt,
        'modelProfile', model_profile,
        'maxSteps', max_steps,
        'tools', tools
    ),
    'create',
    created_by,
    created_at
from agents
on conflict (agent_id, version) do nothing;
