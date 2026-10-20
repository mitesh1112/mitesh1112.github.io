-- Run in the SQL Editor AFTER 06. All test rows are rolled back, even on success.
-- If an assertion fails, run ROLLBACK before doing anything else in this session.
begin;
create temporary table shortcut_test_context as
select gen_random_uuid() as user_id, repeat('a', 64) as token_hash,
       gen_random_uuid()::text as request_id;
grant select on shortcut_test_context to service_role;
insert into public.users (id, name)
select user_id, 'Siri integration test ' || user_id::text from shortcut_test_context;
insert into expense_tracker_private.shortcut_tokens (user_id, label, token_hash)
select user_id, 'Rollback-only test', token_hash from shortcut_test_context;

set local role service_role;
do $$
declare
    c record;
    first_result jsonb;
    retry_result jsonb;
begin
    select * into c from pg_temp.shortcut_test_context;
    first_result := public.log_shortcut_expense(c.token_hash, c.request_id, '2026-10-20', 250.50, 'Food', 'UPI', 'Test');
    retry_result := public.log_shortcut_expense(c.token_hash, c.request_id, '2026-10-20', 250.50, 'Food', 'UPI', 'Test');
    assert first_result->>'success' = 'true' and first_result->>'duplicate' = 'false';
    assert retry_result->>'duplicate' = 'true';
    assert first_result->>'expense_id' = retry_result->>'expense_id';

    begin
        perform public.log_shortcut_expense(c.token_hash, c.request_id, '2026-10-20', 251, 'Food', 'UPI', 'Test');
        raise exception 'Changed retry unexpectedly succeeded';
    exception when sqlstate 'PT409' then null;
    end;

    -- A failed expense insert must roll back its receipt too.
    begin
        perform public.log_shortcut_expense(c.token_hash, repeat('b', 64), '2026-10-20', -1, 'Food', 'UPI', 'Test');
        raise exception 'Invalid amount unexpectedly succeeded';
    exception when check_violation then null;
    end;
    assert not exists (select 1 from expense_tracker_private.shortcut_requests where request_id = repeat('b', 64));

    update expense_tracker_private.shortcut_tokens set revoked_at = now() where token_hash = c.token_hash;
    begin
        perform public.log_shortcut_expense(c.token_hash, c.request_id, '2026-10-20', 250.50, 'Food', 'UPI', 'Test');
        raise exception 'Revoked token unexpectedly succeeded';
    exception when sqlstate 'PT401' then null;
    end;
end;
$$;
reset role;
do $$
declare c record; saved_id uuid; result jsonb;
begin
    assert not has_function_privilege('anon', 'public.log_shortcut_expense(text,text,date,numeric,text,text,text)', 'EXECUTE');
    assert not has_function_privilege('authenticated', 'public.log_shortcut_expense(text,text,date,numeric,text,text,text)', 'EXECUTE');
    assert not has_schema_privilege('anon', 'expense_tracker_private', 'USAGE');
    select * into c from pg_temp.shortcut_test_context;
    select expense_id into strict saved_id from expense_tracker_private.shortcut_requests
        where request_id = c.request_id;
    assert (select count(*) = 1 from public.expenses where id = saved_id and user_id = c.user_id);
    delete from public.expenses where id = saved_id;
    update expense_tracker_private.shortcut_tokens set revoked_at = null where token_hash = c.token_hash;
    result := public.log_shortcut_expense(c.token_hash, c.request_id, '2026-10-20', 250.50, 'Food', 'UPI', 'Test');
    assert result->>'duplicate' = 'true';
    assert not exists (select 1 from public.expenses where id = saved_id);
end;
$$;
rollback;
