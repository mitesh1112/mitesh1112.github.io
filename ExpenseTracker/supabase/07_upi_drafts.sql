-- Run after 01, 02, 03, and 05. Migration 06 is NOT required.
-- Shared access matches the current app; no login or personal shortcut tokens.
begin;

create table public.upi_drafts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete restrict,
    source text not null default 'SBI UPI' check (source = 'SBI UPI'),
    transaction_ref text not null check (transaction_ref ~ '^[0-9]{8,30}$'),
    masked_account text not null,
    date date not null,
    amount numeric(12,2) not null check (amount > 0),
    recipient text not null check (char_length(recipient) between 1 and 200),
    suggested_category text not null default '',
    payment_method text not null default 'UPI' check (payment_method = 'UPI'),
    note text not null,
    status text not null default 'pending' check (status in ('pending', 'saved', 'dismissed')),
    -- Keep the receipt after deletion of a saved expense, preventing re-import.
    saved_expense_id uuid,
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    unique (user_id, source, transaction_ref)
);
create index upi_drafts_pending_idx on public.upi_drafts (user_id, created_at desc, id desc)
    where status = 'pending';
alter table public.upi_drafts enable row level security;
revoke all on public.upi_drafts from public, anon, authenticated;
grant select on public.upi_drafts to anon;
create policy "Shared UPI draft reads" on public.upi_drafts for select to anon using (true);

-- Only this parser creates drafts. It never inserts an expense.
create function public.queue_sbi_upi_message(p_user_id uuid, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    parts text[];
    message_text text;
    payment_date date;
    payment_amount numeric;
    month_number integer;
    draft public.upi_drafts%rowtype;
    new_id uuid;
begin
    if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
        raise sqlstate 'PT422' using message = 'Choose an existing user before preparing a draft.';
    end if;
    if p_message is null or char_length(p_message) > 4000 then
        raise sqlstate 'PT422' using message = 'Provide one SBI UPI debit message, up to 4000 characters.';
    end if;
    message_text := btrim(regexp_replace(p_message, '[[:space:]]+', ' ', 'g'));
    if cardinality(regexp_split_to_array(message_text, '\mRefno\M', 'i')) <> 2 then
        raise sqlstate 'PT422' using message = 'Provide one complete SBI UPI debit message at a time. No draft was created.';
    end if;
    parts := regexp_match(message_text,
        '^Dear UPI user A/C ([Xx*][0-9Xx*]{3,19}) debited by ([0-9]+(?:\.[0-9]{1,2})?) on date ([0-9]{2})([A-Za-z]{3})([0-9]{2}) trf to (.{1,200}) Refno ([0-9]{8,30}) If not u\? .*-SBI\.?$', 'i');
    if parts is null then
        raise sqlstate 'PT422' using message = 'Message does not match the supported SBI UPI debit format. No draft was created.';
    end if;
    month_number := array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], lower(parts[4]));
    begin
        if month_number is null then raise invalid_datetime_format; end if;
        payment_date := make_date(2000 + parts[5]::integer, month_number, parts[3]::integer);
        payment_amount := parts[2]::numeric;
        if payment_amount <= 0 or payment_amount > 9999999999.99 then raise numeric_value_out_of_range; end if;
    exception when datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
        raise sqlstate 'PT422' using message = 'The message has an invalid date or amount. No draft was created.';
    end;

    insert into public.upi_drafts (user_id, transaction_ref, masked_account, date, amount,
        recipient, suggested_category, note)
    values (p_user_id, parts[7], upper(parts[1]), payment_date, payment_amount, btrim(parts[6]),
        case when parts[6] ~* '\m(chemist|pharmacy)\M' then 'Medicine' else '' end,
        btrim(parts[6]) || ' | UPI ref ' || parts[7])
    on conflict (user_id, source, transaction_ref) do nothing returning id into new_id;

    select * into strict draft from public.upi_drafts
    where user_id = p_user_id and source = 'SBI UPI' and transaction_ref = parts[7];
    if draft.amount <> payment_amount or draft.date <> payment_date or
        draft.recipient <> btrim(parts[6]) or draft.masked_account <> upper(parts[1]) then
        raise sqlstate 'PT409' using message = 'This UPI reference already exists with different details. Review it in ExpenseTracker.';
    end if;
    return jsonb_build_object('success', true, 'draft_id', draft.id, 'status', draft.status,
        'duplicate', new_id is null, 'amount', draft.amount, 'recipient', draft.recipient,
        'message', case when new_id is not null then 'UPI draft ready. Open ExpenseTracker to review and save.'
            else 'This UPI payment was already received. No duplicate draft was created.' end);
end;
$$;

-- This is the only draft operation that inserts an expense. The UI calls it on Save.
-- Locking and a single transaction make retries and simultaneous saves idempotent.
create function public.save_upi_draft(p_draft_id uuid, p_date date, p_amount numeric,
    p_category text, p_payment_method text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    draft public.upi_drafts%rowtype;
    expense_id uuid;
begin
    select * into draft from public.upi_drafts where id = p_draft_id for update;
    if not found then raise sqlstate 'PT404' using message = 'UPI draft not found.'; end if;
    if draft.status = 'saved' then
        return jsonb_build_object('success', true, 'expense_id', draft.saved_expense_id, 'duplicate', true);
    end if;
    if draft.status <> 'pending' then
        raise sqlstate 'PT409' using message = 'This draft was dismissed. Refresh pending payments.';
    end if;
    if p_date is null or p_amount is null or p_amount <= 0 or p_amount > 9999999999.99
        or p_amount <> round(p_amount, 2) or p_category is null
        or char_length(btrim(p_category)) not between 1 and 100
        or p_payment_method is null or p_payment_method not in ('UPI', 'Cash', 'Credit Card', 'Net Banking')
        or p_note is null or char_length(p_note) > 2000 then
        raise sqlstate 'PT422' using message = 'Review the date, positive amount, category, payment method, and note before saving.';
    end if;
    insert into public.expenses (date, amount, category, payment_method, note, user_id)
    values (p_date, p_amount, btrim(p_category), p_payment_method, p_note, draft.user_id)
    returning id into expense_id;
    update public.upi_drafts set status = 'saved', saved_expense_id = expense_id, resolved_at = now()
    where id = draft.id;
    return jsonb_build_object('success', true, 'expense_id', expense_id, 'duplicate', false);
end;
$$;

create function public.dismiss_upi_draft(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare draft public.upi_drafts%rowtype;
begin
    select * into draft from public.upi_drafts where id = p_draft_id for update;
    if not found then raise sqlstate 'PT404' using message = 'UPI draft not found.'; end if;
    if draft.status = 'saved' then
        raise sqlstate 'PT409' using message = 'This payment was already saved. Refresh expenses.';
    end if;
    update public.upi_drafts set status = 'dismissed', resolved_at = coalesce(resolved_at, now()) where id = draft.id;
    return jsonb_build_object('success', true, 'draft_id', draft.id);
end;
$$;

revoke all on function public.queue_sbi_upi_message(uuid, text) from public, anon, authenticated;
revoke all on function public.save_upi_draft(uuid, date, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.dismiss_upi_draft(uuid) from public, anon, authenticated;
grant execute on function public.queue_sbi_upi_message(uuid, text) to anon;
grant execute on function public.save_upi_draft(uuid, date, numeric, text, text, text) to anon;
grant execute on function public.dismiss_upi_draft(uuid) to anon;

commit;
