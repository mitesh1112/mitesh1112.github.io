---
name: expense-tracker
description: Maintain this ExpenseTracker static web app, its Supabase schema and Google Forms workbook importer, and its GitHub Pages deployment compatibility. Use for changes or debugging in the ExpenseTracker project.
---

# ExpenseTracker

## Project and hosting

Work in the ExpenseTracker directory of the mitesh1112/mitesh1112.github.io repository. The known workspace is D:/mitesh/temp/mitesh1112.github.io/ExpenseTracker; locate the current checkout if it has moved.

The deployment target is GitHub Pages. The expected URL for this repository layout is https://mitesh1112.github.io/ExpenseTracker/; this is an expected address, not evidence of a live deployment. No Pages workflow was present when this skill was created. Inspect current repository configuration before changing deployment behavior or claiming publication succeeded.

The app is static: index.html and app.js run directly in the browser, with no build step, package manifest, or application server. Keep local asset URLs relative, such as ./app.js, so the app works under /ExpenseTracker/. Supabase supplies the remote database. Browser dependencies currently come from CDNs: Tailwind CSS, Supabase JavaScript v2, Chart.js 4.4.8, and Font Awesome. Preserve this architecture unless the requested change calls for replacing it.

Creating or maintaining this skill does not authorize pushing commits, publishing the site, or executing database changes.

## Files to inspect

- index.html: markup, Tailwind classes, inline styles, form constraints, script loading, accessible status messages, and chart fallback.
- app.js: Supabase configuration, user directory, form submission, deletion, feed pagination, search, and monthly dashboard.
- supabase/01_expenses.sql through 03_users_table.sql: ordered database setup and migration history.
- supabase/import_google_sheet.py: XLSX parser and repeatable SQL import generator, with optional database execution.
- supabase/04_import_google_sheet.sql: generated data import, not a schema migration.
- tests/app.test.cjs: Node's built-in test runner with mocked DOM, Chart.js, and Supabase.
- tests/test_import_google_sheet.py: Python unittest coverage for workbook parsing and generated SQL.

Read the affected files before editing. Treat this skill as a project map; current source is authoritative if the project changes.

## Supabase database

The browser endpoint in app.js is https://swvimqzgxhrshkfvawxd.supabase.co. Read the current SUPABASE_URL and SUPABASE_PUBLIC_KEY there instead of duplicating the key in documentation. A publishable browser key belongs in this static app; database passwords, service_role keys, and sb_secret_ keys do not.

The following schema and policies are derived from local SQL files. They do not prove which migrations have been applied to the live project.

### Tables after migration 03

public.users:
- id: UUID primary key, default gen_random_uuid().
- name: unique, non-null text, trimmed and 1 to 100 characters.
- created_at: non-null timestamptz, default now().

public.expenses:
- id: UUID primary key, default gen_random_uuid().
- date: non-null date, default current_date.
- amount: non-null numeric(12,2), greater than zero.
- category: non-null text with trimmed length from 1 to 100.
- note: non-null text, default empty string, maximum 2000 characters.
- created_at: non-null timestamptz, default now().
- added_by: nullable legacy text snapshot. Keep historical values; new browser inserts use user_id.
- user_id: nullable UUID foreign key to public.users(id), ON DELETE RESTRICT. The constraint name expenses_user_id_fkey is explicitly referenced by the frontend join.

Indexes cover date/created_at ordering and user_id. Legacy rows without attribution may retain a null user_id and display "Not recorded".

### Setup and access

Apply 01_expenses.sql, 02_users_and_delete.sql, then 03_users_table.sql for a new database. Script 01 is initial setup and fails if the expenses table already exists. Inspect applied schema before rerunning setup. For subsequent schema changes, add the next appropriate migration and update affected frontend queries and setup messages.

Migration 02 introduced legacy added_by values and anonymous deletes. Migration 03 creates the user directory, seeds initial names, preserves historical names, backfills user_id, and replaces the anonymous insert policy to require non-null user_id. Load current names from users rather than hardcoding the seed list.

RLS is enabled on both tables:
- anon can read users; the browser cannot create, rename, or remove users.
- anon can read, insert, and delete expenses; inserts require a non-null user_id backed by the foreign key.
- There is no browser update grant and no authenticated-user ownership enforcement in these scripts.

The name selector is attribution, not authentication. It does not restrict feed visibility or deletion to the selected person. Document this existing shared development access accurately; changing it to private per-user access requires coordinated authentication, grants, policies, and frontend changes within the user's requested scope.

## Frontend behavior to preserve

- Use en-IN and INR formatting. Browser date inputs and current-month boundaries use local calendar dates; avoid UTC conversions that shift date-only values.
- Load users in stable name/id order and continue paging until an empty response. Store the selected UUID under expense-tracker.active-user; support legacy stored names and unavailable localStorage.
- New expenses require a valid selected user_id. Keep existing entries when save confirmation fails. A successful insert followed by a failed refresh must remain reported as saved, avoiding duplicate resubmission.
- Feed pages contain 50 rows ordered by date, created_at, then id descending, with an exact count. Search covers loaded rows only and matches category, note, date, and displayed user name.
- Monthly totals query the entire current month independently of loaded feed pages. Queries use an inclusive month start and exclusive next-month start, stable id order, and repeated ranges. Continue based on actual returned rows rather than assuming the requested range size was fulfilled.
- Sum money in integer paise for dashboard calculations. Preserve stale-request protection and the visible fallback when chart rendering is unavailable.
- Delete only after the existing confirmation. Verify the returned deleted ID before reporting success, adjust pagination offsets, and update monthly totals without allowing an older in-flight request to restore deleted data.
- Keep labels, keyboard focus, disabled/loading states, aria status messages, and readable category breakdowns. Render user-provided text with textContent.

## Google Forms workbook imports

The importer consumes an exported XLSX workbook, not a live Sheets connection. Read only "Form Responses 1"; exclude Calc_Data summaries. Expected columns A through E are Timestamp, Email Address, Type, Description, and Amount.

Preserve normalized lowercase email identity, original note text, Decimal validation, and India-local (+05:30) Google Forms timestamps. The importer expects Excel's 1900 date system, rejects formulas and exact duplicate source entries, and derives stable UUIDv5 expense IDs from canonical records. Do not change its namespace or canonicalization casually; doing so changes replay identities.

SQL reuses or inserts email-valued users.name entries, links expenses through user_id, avoids existing matching records and conflicting IDs, and verifies all source records before committing. Do not conflate these email identities with the seeded display names without an explicit mapping request.

Default use generates SQL only:
```powershell
python supabase/import_google_sheet.py "path/to/workbook.xlsx" --output "path/to/reviewed-import.sql"
```

Generation requires only Python's standard library and overwrites the output file. Use an explicit scratch output when inspecting a new workbook so the committed 04_import_google_sheet.sql is not replaced accidentally. Database options --inspect and --execute additionally need psycopg, use TLS, and request the password interactively. Even --inspect prepares the output file before connecting. Execute imports only when authorized; never save credentials to source, SQL, or this skill.

## Verification

For JavaScript changes, run from ExpenseTracker:
```powershell
node --test tests/app.test.cjs
```

For importer changes:
```powershell
python -m unittest discover -s tests -p "test_import_google_sheet.py"
```

Use focused regressions for changed behavior. These tests use local mocks and fixtures; passing them does not verify live Supabase policies or a published Pages site.

For UI or path changes, serve the checkout locally, for example with python -m http.server 8000, and check form feedback, user selection, pagination, responsive layout, and chart fallback as relevant. Serve from the repository parent when checking the /ExpenseTracker/ subpath. Report only the checks actually performed, and distinguish prepared migration or publishing files from changes applied remotely.