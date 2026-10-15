"""Prepare or execute a repeatable import of the Google Forms expense workbook.

Uses Python's standard library to read XLSX. Database commands additionally need
psycopg (may be installed in TEMP/expense-tracker-import-deps). Passwords are
requested interactively and are never saved in source or generated SQL.
"""

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import getpass
import json
import os
from pathlib import Path
import sys
import uuid
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
INDIA = timezone(timedelta(hours=5, minutes=30))
IMPORT_NAMESPACE = uuid.UUID('963fa87a-d45e-4d99-a4d2-8c232f00185a')


def read_expenses(path):
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        properties = workbook.find('s:workbookPr', NS)
        if properties is not None and properties.get('date1904') in ('1', 'true'):
            raise ValueError('This importer expects the Excel 1900 date system.')
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(t.text or '' for t in item.findall('.//s:t', NS))
                       for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        sheet = next((s for s in workbook.findall('s:sheets/s:sheet', NS)
                      if s.get('name') == 'Form Responses 1'), None)
        if sheet is None:
            raise ValueError('Form Responses 1 sheet is missing.')
        relation_id = sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        relations = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = next(r.get('Target') for r in relations if r.get('Id') == relation_id)
        sheet_path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        rows = ET.fromstring(archive.read(sheet_path)).findall('s:sheetData/s:row', NS)

        def values(row):
            result = {}
            for cell in row.findall('s:c', NS):
                if cell.find('s:f', NS) is not None:
                    raise ValueError(f'Formula cells are unsupported in source data: {cell.get("r")}')
                value = cell.find('s:v', NS)
                text = value.text or '' if value is not None else ''
                if cell.get('t') == 's':
                    text = strings[int(text)]
                elif cell.get('t') == 'inlineStr':
                    text = ''.join(t.text or '' for t in cell.findall('.//s:t', NS))
                result[''.join(c for c in cell.get('r') if c.isalpha())] = text
            return result

        if [values(rows[0]).get(c) for c in 'ABCDE'] != ['Timestamp', 'Email Address', 'Type', 'Description', 'Amount']:
            raise ValueError('Unexpected response column headers.')
        expenses = []
        for row in rows[1:]:
            source = values(row)
            if not any(source.values()):
                continue
            email = source.get('B', '').strip().lower()
            category = source.get('C', '').strip()
            note = source.get('D', '')
            amount = Decimal(source.get('E', ''))
            if not amount.is_finite() or amount <= 0 or amount > Decimal('9999999999.99') or amount != amount.quantize(Decimal('.01')):
                raise ValueError(f'Invalid amount on row {row.get("r")}')
            if '@' not in email or not 1 <= len(email) <= 100 or not 1 <= len(category) <= 100 or len(note) > 2000:
                raise ValueError(f'Invalid email/category/note on row {row.get("r")}')
            # Google Forms timestamps in this workbook are local India timestamps.
            milliseconds = int((Decimal(source['A']) * 86400000).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
            timestamp = (datetime(1899, 12, 30) + timedelta(milliseconds=milliseconds)).replace(tzinfo=INDIA)
            item = dict(email=email, date=timestamp.date().isoformat(), amount=f'{amount:.2f}',
                        category=category, note=note, created_at=timestamp.isoformat())
            canonical = json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            item['id'] = str(uuid.uuid5(IMPORT_NAMESPACE, canonical))
            expenses.append(item)
        if len({item['id'] for item in expenses}) != len(expenses):
            raise ValueError('Duplicate source entries detected; review them before import.')
        if not expenses:
            raise ValueError('No expenses found.')
        return expenses


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def build_sql(expenses):
    columns = ['id', 'email', 'date', 'amount', 'category', 'note', 'created_at']
    records = ',\n'.join('(' + ', '.join(quote(item[c]) for c in columns) + ')' for item in expenses)
    return """-- Generated from Form Responses 1 only; Calc_Data summaries are excluded.
-- Run after migrations 01, 02, and 03. Existing email users are reused.
-- Expense IDs are deterministic: running this file again does not duplicate rows.
begin;
set local standard_conforming_strings = on;
create temporary table sheet_import (
    id uuid primary key, email text not null, date date not null,
    amount numeric(12,2) not null, category text not null, note text not null,
    created_at timestamptz not null
) on commit drop;
insert into sheet_import (id,email,date,amount,category,note,created_at) values
""" + records + """;
insert into public.users (name)
select distinct email from sheet_import
on conflict (name) do nothing;

insert into public.expenses (id,date,amount,category,note,created_at,user_id)
select source.id, source.date, source.amount, source.category, source.note,
       source.created_at, person.id
from sheet_import as source
join public.users as person on person.name = source.email
where not exists (
    select 1 from public.expenses as existing
    where existing.user_id = person.id and existing.date = source.date
      and existing.amount = source.amount and existing.category = source.category
      and existing.note = source.note and existing.created_at = source.created_at
)
on conflict (id) do nothing;

-- Abort the entire transaction if any source record is missing or inconsistent.
do $$
begin
    if exists (
        select 1 from sheet_import as source
        where not exists (
            select 1 from public.expenses as expense
            join public.users as person on person.id = expense.user_id
            where person.name = source.email and expense.date = source.date
              and expense.amount = source.amount and expense.category = source.category
              and expense.note = source.note and expense.created_at = source.created_at
        )
    ) then
        raise exception 'Import verification failed: missing or mismatched expenses';
    end if;
end $$;

select count(*) as source_expenses, sum(amount) as source_total from sheet_import;
commit;
"""


def connect(args):
    sys.path.insert(0, str(Path(os.environ.get('TEMP', '.')) / 'expense-tracker-import-deps'))
    import psycopg
    password = getpass.getpass('Database password (hidden): ')
    return psycopg.connect(host=args.host, port=args.port,
                          dbname='postgres', user=args.user, password=password,
                          sslmode='require', connect_timeout=15)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--inspect', action='store_true', help='Read database schema and counts without importing')
    parser.add_argument('--host', default='db.swvimqzgxhrshkfvawxd.supabase.co')
    parser.add_argument('--port', type=int, default=5432)
    parser.add_argument('--user', default='postgres')
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / '04_import_google_sheet.sql')
    args = parser.parse_args()
    expenses = read_expenses(args.workbook)
    summary = {'expenses': len(expenses), 'total_inr': str(sum(Decimal(e['amount']) for e in expenses)),
               'first_date': min(e['date'] for e in expenses), 'last_date': max(e['date'] for e in expenses),
               'users': dict(Counter(e['email'] for e in expenses))}
    print(json.dumps(summary, indent=2))
    sql = build_sql(expenses)
    args.output.write_text(sql, encoding='utf-8')
    print(f'Prepared SQL: {args.output}')
    if not (args.execute or args.inspect):
        return
    with connect(args) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select table_name,column_name from information_schema.columns where table_schema='public' and table_name in ('users','expenses')")
            columns = set(cursor.fetchall())
            required = {('users', 'id'), ('users', 'name'), ('expenses', 'user_id')}
            if not required.issubset(columns):
                raise ValueError('Apply the SQL migrations through 03_users_table.sql first.')
            cursor.execute('select count(*), coalesce(sum(amount),0) from public.expenses')
            print('Before import (expenses, total):', cursor.fetchone())
            if args.inspect:
                cursor.execute('select name from public.users order by name')
                print('Existing users:', json.dumps([r[0] for r in cursor.fetchall()]))
                return
        # The generated script owns its BEGIN/COMMIT transaction.
        connection.commit()
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute(sql)
            while cursor.nextset():
                pass
            cursor.execute('select count(*), coalesce(sum(amount),0) from public.expenses')
            print('After import (expenses, total):', cursor.fetchone())
    print('Import committed and all source records verified.')


if __name__ == '__main__':
    main()
