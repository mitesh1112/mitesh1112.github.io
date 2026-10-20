-- Run after schema migrations 01, 02, 03, and 05. No expense data is changed.
begin;

create schema if not exists expense_tracker_private;
revoke all on schema expense_tracker_private from public, anon, authenticated;
grant usage on schema expense_tracker_private to service_role;

create table expense_tracker_private.shortcut_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete restrict,
    label text not null check (char_length(label) between 1 and 100),
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default now(),
    revoked_at timestamptz
);

-- Retain receipts even if an expense is later deleted, so retries cannot recreate it.
create table expense_tracker_private.shortcut_requests (
    token_id uuid not null references expense_tracker_private.shortcut_tokens(id),
    request_id text not null check (request_id ~ '^[0-9a-f]{64}$' or
        request_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    payload jsonb not null,
    expense_id uuid not null default gen_random_uuid(),
    created_at timestamptz not null default now(),
    primary key (token_id, request_id)
);

alter table expense_tracker_private.shortcut_tokens enable row level security;
alter table expense_tracker_private.shortcut_requests enable row level security;
revoke all on all tables in schema expense_tracker_private from public, anon, authenticated;
-- UPDATE privilege is also required by SELECT ... FOR SHARE.
grant select, update on expense_tracker_private.shortcut_tokens to service_role;
grant select, insert, update on expense_tracker_private.shortcut_requests to service_role;
grant insert on public.expenses to service_role;

create function public.log_shortcut_expense(
    p_token_hash text, p_request_id text, p_date date, p_amount numeric,
    p_category text, p_payment_method text, p_note text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_token expense_tracker_private.shortcut_tokens%rowtype;
    v_request expense_tracker_private.shortcut_requests%rowtype;
    v_payload jsonb;
    v_new_id uuid;
begin
    -- Lock against revocation until this save transaction completes.
    select * into v_token from expense_tracker_private.shortcut_tokens
    where token_hash = p_token_hash and revoked_at is null for share;
    if not found then
        raise sqlstate 'PT401' using message = 'Invalid or revoked shortcut token.';
    end if;

    v_payload := jsonb_build_object('date', p_date, 'amount', p_amount,
        'category', p_category, 'payment_method', p_payment_method, 'note', p_note);

    -- The unique key serializes concurrent retries. Both inserts commit together.
    insert into expense_tracker_private.shortcut_requests (token_id, request_id, payload)
    values (v_token.id, p_request_id, v_payload)
    on conflict (token_id, request_id) do nothing
    returning expense_id into v_new_id;

    select * into strict v_request from expense_tracker_private.shortcut_requests
    where token_id = v_token.id and request_id = p_request_id for update;
    if v_request.payload is distinct from v_payload then
        raise sqlstate 'PT409' using message = 'Request ID was already used for different expense details.';
    end if;

    if v_new_id is not null then
        insert into public.expenses (id, date, amount, category, payment_method, note, user_id)
        values (v_new_id, p_date, p_amount, p_category, p_payment_method, p_note, v_token.user_id);
    end if;
    return jsonb_build_object('success', true, 'expense_id', v_request.expense_id,
        'duplicate', v_new_id is null);
end;
$$;

revoke all on function public.log_shortcut_expense(text, text, date, numeric, text, text, text)
    from public, anon, authenticated;
grant execute on function public.log_shortcut_expense(text, text, date, numeric, text, text, text)
    to service_role;

commit;
