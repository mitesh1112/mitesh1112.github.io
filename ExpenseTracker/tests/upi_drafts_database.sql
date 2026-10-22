-- Run after migration 07 in the SQL Editor. All test data is rolled back.
-- If an assertion fails, run ROLLBACK before proceeding.
begin;
create temporary table upi_test_context as select gen_random_uuid() as user_id;
insert into public.users (id, name) select user_id, 'UPI test ' || user_id::text from upi_test_context;
grant select on upi_test_context to anon;
set local role anon;

do $$
declare
    person uuid;
    first_message text := 'Dear UPI user A/C X5901 debited by 56.00 on date 21Oct26 trf to M/S.SKY CHEMIST Refno 210727313985 If not u? call-1800111109 for other services-18001234-SBI';
    second_message text := 'Dear UPI user A/C X5901 debited by 50.00 on date 22Oct26 trf to Mr RAJESH MANEK Refno 104219318709 If not u? call-1800111109 for other services-18001234-SBI';
    response jsonb;
    first_id uuid;
    second_id uuid;
    saved_id uuid;
    invalid_message text;
begin
    select user_id into person from pg_temp.upi_test_context;
    response := public.queue_sbi_upi_message(person, first_message);
    first_id := (response->>'draft_id')::uuid;
    assert response->>'success' = 'true' and response->>'duplicate' = 'false';
    assert (select amount = 56.00 and date = '2026-10-21' and recipient = 'M/S.SKY CHEMIST'
        and suggested_category = 'Medicine' and payment_method = 'UPI' and status = 'pending'
        from public.upi_drafts where id = first_id);
    assert not exists (select 1 from public.expenses where user_id = person), 'Ingestion must never save an expense';

    response := public.queue_sbi_upi_message(person, E'\n ' || replace(first_message, ' debited', E'\n debited') || ' ');
    assert response->>'duplicate' = 'true' and (response->>'draft_id')::uuid = first_id;
    response := public.queue_sbi_upi_message(person, second_message);
    second_id := (response->>'draft_id')::uuid;
    assert (select date = '2026-10-22' and amount = 50.00 and suggested_category = ''
        and recipient = 'Mr RAJESH MANEK' from public.upi_drafts where id = second_id);
    assert (select count(*) = 2 from public.upi_drafts where user_id = person);

    foreach invalid_message in array array[
        replace(first_message, 'debited', 'credited'),
        replace(first_message, '21Oct26', '31Feb26'),
        replace(first_message, '21Oct26', '21Abc26'),
        replace(first_message, '56.00', '0.00'),
        replace(first_message, '56.00', '56.001'),
        replace(first_message, '56.00', '10000000000.00'),
        replace(first_message, 'Dear UPI user', 'Payment failed'),
        'OTP 123456 for UPI transaction',
        first_message || E'\n' || second_message
    ] loop
        begin
            perform public.queue_sbi_upi_message(person, invalid_message);
            raise exception 'Invalid message unexpectedly accepted: %', invalid_message;
        exception when sqlstate 'PT422' then null;
        end;
    end loop;
    begin
        perform public.queue_sbi_upi_message(null, first_message);
        raise exception 'Missing user accepted';
    exception when sqlstate 'PT422' then null;
    end;
    begin
        perform public.queue_sbi_upi_message(person, replace(first_message, '56.00', '57.00'));
        raise exception 'Conflicting reference accepted';
    exception when sqlstate 'PT409' then null;
    end;
    assert (select count(*) = 2 from public.upi_drafts where user_id = person);

    begin
        perform public.save_upi_draft(first_id, '2026-10-21', 56, '', 'UPI', 'Test');
        raise exception 'Missing category accepted';
    exception when sqlstate 'PT422' then null;
    end;
    assert not exists (select 1 from public.expenses where user_id = person);
    assert (select status = 'pending' from public.upi_drafts where id = first_id);

    response := public.save_upi_draft(first_id, '2026-10-22', 57.50, 'Medicine', 'UPI', 'Reviewed note');
    saved_id := (response->>'expense_id')::uuid;
    assert response->>'success' = 'true' and response->>'duplicate' = 'false';
    assert (select user_id = person and amount = 57.50 and date = '2026-10-22'
        and note = 'Reviewed note' from public.expenses where id = saved_id);
    response := public.save_upi_draft(first_id, '2026-10-22', 57.50, 'Medicine', 'UPI', 'Reviewed note');
    assert response->>'duplicate' = 'true' and (response->>'expense_id')::uuid = saved_id;
    assert (select count(*) = 1 from public.expenses where user_id = person);
    response := public.queue_sbi_upi_message(person, first_message);
    assert response->>'status' = 'saved' and response->>'duplicate' = 'true';

    -- Deleting a saved expense must not allow the SMS or Save retry to recreate it.
    delete from public.expenses where id = saved_id;
    response := public.save_upi_draft(first_id, '2026-10-22', 57.50, 'Medicine', 'UPI', 'Reviewed note');
    assert response->>'duplicate' = 'true';
    assert not exists (select 1 from public.expenses where user_id = person);

    response := public.dismiss_upi_draft(second_id);
    assert response->>'success' = 'true';
    response := public.queue_sbi_upi_message(person, second_message);
    assert response->>'status' = 'dismissed' and response->>'duplicate' = 'true';
    begin
        perform public.save_upi_draft(second_id, '2026-10-22', 50, 'Other', 'UPI', 'Test');
        raise exception 'Dismissed payment was saved';
    exception when sqlstate 'PT409' then null;
    end;
    assert not has_table_privilege('anon', 'public.upi_drafts', 'INSERT');
    assert not has_table_privilege('anon', 'public.upi_drafts', 'UPDATE');
    assert not has_table_privilege('anon', 'public.upi_drafts', 'DELETE');
end;
$$;
reset role;
rollback;
