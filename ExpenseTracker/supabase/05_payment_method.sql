-- Run after schema migrations 01, 02, and 03 in the Supabase SQL Editor.
-- 04_import_google_sheet.sql is an optional data import, not a prerequisite.
-- Existing expenses and workbook imports have no known payment method.
-- New entries in the browser require an explicit selection.
begin;

alter table public.expenses
    add column payment_method text
    constraint expenses_payment_method_check
    check (payment_method in ('UPI', 'Cash', 'Credit Card', 'Net Banking'));

comment on column public.expenses.payment_method is
    'Payment method; NULL means not recorded for legacy or imported expenses.';

commit;
