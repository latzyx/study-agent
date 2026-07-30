create or replace function finalize_ai_run_spans()
returns trigger
language plpgsql
as $$
begin
    if old.status = 'running' and new.status <> 'running' then
        update ai_spans
        set status = new.status,
            finished_at = coalesce(new.finished_at, now()),
            duration_ms = greatest(
                0,
                extract(epoch from (coalesce(new.finished_at, now()) - started_at)) * 1000
            )::int,
            error_name = case
                when new.status in ('error', 'aborted') then coalesce(error_name, new.error_name)
                else error_name
            end,
            error_message = case
                when new.status in ('error', 'aborted') then coalesce(error_message, new.error_message)
                else error_message
            end
        where run_id = new.id
          and status = 'running';
    end if;

    return new;
end;
$$;

drop trigger if exists ai_runs_finalize_spans_trigger on ai_runs;

create trigger ai_runs_finalize_spans_trigger
after update of status on ai_runs
for each row
execute function finalize_ai_run_spans();
