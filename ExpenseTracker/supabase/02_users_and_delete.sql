-- Run AFTER 01_expenses.sql in the Supabase Dashboard SQL Editor.
-- Existing expenses keep a NULL added_by value (shown as "Not recorded").
-- Names are self-selected labels, not authenticated identities.
-- Shared development access: any anonymous visitor can delete any expense.

begin;

alter table public.expenses
    add column if not exists added_by text
    constraint expenses_added_by_check
    check (added_by in ('Mitesh', 'Neha', 'Brinda', 'Harshal'));

-- Require a valid name for NEW anonymous inserts without inventing ownership
-- for expenses that were recorded before this migration.
drop policy if exists "Development anonymous expense inserts" on public.expenses;
create policy "Development anonymous expense inserts"
    on public.expenses
    for insert
    to anon
    with check (added_by is not null and added_by in ('Mitesh', 'Neha', 'Brinda', 'Harshal'));

grant delete on table public.expenses to anon;

drop policy if exists "Development anonymous expense deletes" on public.expenses;
create policy "Development anonymous expense deletes"
    on public.expenses
    for delete
    to anon
    using (true);

commit;
