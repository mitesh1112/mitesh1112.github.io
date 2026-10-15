-- Phase 1: Run this entire script in the Supabase Dashboard SQL Editor.
-- Initial setup for a new database; an existing expenses table causes a rollback.
-- DEVELOPMENT ONLY: anyone with the public API key can read and add expenses.
-- Replace these policies with per-user access before storing private expenses.

begin;

create table public.expenses (
    id uuid primary key default gen_random_uuid(),
    date date not null default current_date,
    amount numeric(12, 2) not null check (amount > 0),
    category text not null check (char_length(btrim(category)) between 1 and 100),
    note text not null default '' check (char_length(note) <= 2000),
    created_at timestamptz not null default now()
);

-- Supports recent expenses and monthly date-range queries.
create index expenses_date_created_at_idx
    on public.expenses (date desc, created_at desc);

alter table public.expenses enable row level security;

-- Explicit grants avoid relying on project-specific default privileges.
revoke all privileges on table public.expenses from public, anon, authenticated;
grant usage on schema public to anon;
grant select, insert on table public.expenses to anon;

create policy "Development anonymous expense reads"
    on public.expenses
    for select
    to anon
    using (true);

create policy "Development anonymous expense inserts"
    on public.expenses
    for insert
    to anon
    with check (true);

commit;
