-- Run AFTER 01_expenses.sql and 02_users_and_delete.sql.
-- Manage names in public.users using the Supabase Table Editor.
-- The browser may read users, but cannot create, rename, or remove them.

begin;

create table if not exists public.users (
    id uuid primary key default gen_random_uuid(),
    name text not null unique
        check (name = btrim(name) and char_length(name) between 1 and 100),
    created_at timestamptz not null default now()
);

-- Initial records only; the application loads names from this table.
insert into public.users (name)
values ('Mitesh'), ('Neha'), ('Brinda'), ('Harshal')
on conflict (name) do nothing;

-- Preserve every previously recorded name before linking historical expenses.
insert into public.users (name)
select distinct btrim(added_by) from public.expenses
where added_by is not null and btrim(added_by) <> ''
on conflict (name) do nothing;

alter table public.expenses
    add column if not exists user_id uuid
    constraint expenses_user_id_fkey references public.users(id) on delete restrict;

update public.expenses as expense
set user_id = person.id
from public.users as person
where expense.user_id is null and btrim(expense.added_by) = person.name;

-- Retain the old text as historical data; new expenses use user_id exclusively.
-- Legacy expenses with no recorded person retain a NULL user_id.
alter table public.expenses drop constraint if exists expenses_added_by_check;
comment on column public.expenses.added_by is
    'Legacy name snapshot. New expenses reference public.users through user_id.';
create index if not exists expenses_user_id_idx on public.expenses(user_id);

alter table public.users enable row level security;
revoke all privileges on table public.users from public, anon, authenticated;
grant usage on schema public to anon;
grant select on table public.users to anon;

drop policy if exists "Anonymous user directory reads" on public.users;
create policy "Anonymous user directory reads"
    on public.users for select to anon using (true);

drop policy if exists "Development anonymous expense inserts" on public.expenses;
create policy "Development anonymous expense inserts"
    on public.expenses for insert to anon
    with check (user_id is not null);

commit;
