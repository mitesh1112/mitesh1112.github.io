# Log expenses from Siri: optional token-based approach

For the simpler direct API setup, follow [SIRI_SETUP.md](./SIRI_SETUP.md).
This document preserves the earlier approach with personal tokens and retry receipts.

The implementation uses Apple Shortcuts and a Supabase Edge Function. No native app,
App Store installation, or change to the browser form is required. Internet access is
required. These files prepare the integration; they do not mean it is deployed.

## 1. Apply the database migration (computer)

Open the [project SQL Editor](https://supabase.com/dashboard/project/swvimqzgxhrshkfvawxd/sql/new).
Confirm this is the ExpenseTracker project. First run:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'expenses'
and column_name in ('user_id', 'payment_method');
select id, name from public.users order by name, id;
```

Both columns must appear. If payment_method is missing, apply
`supabase/05_payment_method.sql` first. If user_id or users is missing, finish the
existing schema setup (01, 02, 03) before continuing. Do not rerun 01 on an existing
expenses table. The 04 workbook import is not required.

Copy the full contents of `supabase/06_siri_shortcuts.sql` into a new SQL query and
run it once. It creates private token/receipt tables and a service-only save
function; it does not modify existing expense rows or browser access policies.

Then run `tests/shortcut_database.sql` in a separate query. It checks attribution,
retry handling, rollback on failure, revocation, and access permissions. Test data
is rolled back. Success means no assertion error. If it fails, run `ROLLBACK;` and
resolve the error before continuing. This test does not simulate concurrent connections.

## 2. Deploy the function using the dashboard (computer)

In PowerShell, from the ExpenseTracker folder, run:

```powershell
.\supabase\functions\log-expense\dashboard-source.ps1
```

This copies the complete function source to your clipboard. It reads the checked-in
source files and does not copy any credentials. If script execution is disabled,
paste these individual commands into PowerShell instead:

```powershell
$siriHandler = (Get-Content .\supabase\functions\log-expense\handler.mjs -Raw).Replace('export function ', 'function ')
$siriEntry = (Get-Content .\supabase\functions\log-expense\index.ts -Raw) -replace '(?m)^import .*\r?\n', ''
Set-Clipboard -Value ($siriHandler + "`n" + $siriEntry)
```

Open [Edge Functions](https://supabase.com/dashboard/project/swvimqzgxhrshkfvawxd/functions).
Create a function using the editor, name it **log-expense**, replace the sample
`index.ts` with the clipboard contents, and deploy it. In its settings, disable
**Verify JWT** (the label may mention the legacy secret), and save the setting.
Authentication is instead enforced by the function's `X-Shortcut-Token` check;
disabling JWT verification alone never authorizes an expense.

The server needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, normally provided
by hosted Supabase. Confirm their availability in Edge Function secrets. Keep
the service-role key on Supabase; never put it in the shortcut or repository.

The deployed URL should be:

```text
https://swvimqzgxhrshkfvawxd.supabase.co/functions/v1/log-expense
```

Confirm deployment with this read-only check in PowerShell:

```powershell
try {
    Invoke-RestMethod 'https://swvimqzgxhrshkfvawxd.supabase.co/functions/v1/log-expense'
} catch {
    $_.ErrorDetails.Message
}
```

Expected: an HTTP 405 response containing `Use POST to log an expense.`
An HTTP 401 mentioning a missing authorization header means JWT verification is
still enabled; 404 usually means the function name or deployment is wrong.

### Optional CLI route instead

Node.js is already available on this computer. From ExpenseTracker:

```powershell
npx supabase login
npx supabase functions deploy log-expense --project-ref swvimqzgxhrshkfvawxd --no-verify-jwt --use-api
```

The first command may prompt to install the CLI, then guides you through signing in.
The second uses the project's function configuration and deploys without Docker.
Use either the dashboard or CLI route. Neither route applies migration 06; do step 1
in the SQL Editor first. No database password is needed for the dashboard route.

## 3. Create your personal shortcut token (computer)

Copy your existing user UUID from the `public.users` query in step 1. In PowerShell:

```powershell
python .\supabase\create_shortcut_token.py --user-id YOUR-EXISTING-USER-UUID --label "Mitesh iPhone Siri"
```

The command prints two things:

1. A personal token starting with `et_`. Put it in your private iPhone shortcut.
2. Enrollment SQL containing only the token's SHA-256 hash. Run that SQL in the
   Supabase SQL Editor. Keep the returned token record ID for future revocation.

The script does not connect to Supabase or write a credential file. Do not redirect
its output into this repository. A person with the token can add expenses as that
person until it is revoked. Use a different token for each person/device. A token
cannot override its associated user by sending a different user_id.

## 4. Build Log Expense in iPhone Shortcuts

Open **Shortcuts**, tap **+**, and rename the shortcut **Log Expense**. Add the
actions below. When a later action needs an earlier result, select its variable
using the variable picker rather than typing the variable name as literal text.

### Gather and confirm the expense

| Action | Configuration / output variable |
| --- | --- |
| Ask for Input | Number; prompt `How much did you spend?`; Set Variable → `Amount` |
| Ask for Input | Text; prompt `Which category?`; Set Variable → `Category` |
| Ask for Input | Text; prompt `Which payment method?`; Set Variable → `PaymentMethod` |
| Text | Empty text; Set Variable → `Note` (you can later replace this with another prompt) |
| Current Date | Follow with Format Date: Custom `yyyy-MM-dd`; Set Variable → `ExpenseDate` |
| Choose from Menu | Prompt `Save [Amount] rupees for [Category] using [PaymentMethod]?`; choices Save and Cancel |

In **Cancel**, add **Stop This Shortcut** (some versions call this **Stop and Output**).
Put the remaining actions in **Save**. Shortcuts' prompt/menu presentation can vary
between manual and Siri runs; test the menu by voice on your iPhone.

Payment methods: **UPI**, **Cash**, **Credit Card**, **Net Banking**.
Categories match the current browser form:

```text
Apparels, Donation, Entertainment, Food, Fuel, Grocery,
Grooming/Beauty Parlour, Home, Insurance, Medicine, Mitesh Activa,
Mobile Recharge, Other, PGVCL, School, Shine, Tution
```

Capitalization and surrounding spaces are normalized. Unrecognized categories or
payment methods are rejected so dictation errors do not silently create new groups.
Dates use the phone's local calendar date; do not convert them to UTC.

### Generate a request ID using built-in actions

Apple Shortcuts may not provide a built-in Generate UUID action. This integration
also accepts a SHA-256 request ID, so no third-party actions app is needed:

1. **Current Date → Format Date**, custom `yyyyMMddHHmmssSSS`; keep the result.
2. Add **Random Number** twice, each from `0` to `2147483647`; keep both results.
3. Add **Text** containing the timestamp and both random numbers, separated by `-`.
4. Add **Generate Hash**, choose **SHA-256**, using that Text.
5. **Set Variable** → `RequestID`.

Generate this once per new expense, before saving the pending file. Do not regenerate
it when retrying a request whose outcome is uncertain.

### Preserve a pending expense before sending

This allows a retry even if Shortcuts stops because the network fails.

1. Add **Dictionary** with the following keys, types, and variable values:

   | Key | Type | Value |
   | --- | --- | --- |
   | request_id | Text | RequestID |
   | date | Text | ExpenseDate |
   | amount | Number | Amount |
   | category | Text | Category |
   | payment_method | Text | PaymentMethod |
   | note | Text | Note |

2. Use **Get Text from Input** on that Dictionary to serialize it as JSON.
3. Use **Set Name** to name the text `expense-tracker-pending.json`.
4. Use **Save File** in the Shortcuts folder on iCloud Drive, with **Ask Where to
   Save** off and **Overwrite If File Exists** on. Keep the filename fixed.
5. Keep the Dictionary as a variable named `ExpensePayload` for the request below.

At the **very beginning of the shortcut**, before collecting a new expense, add
**Get File from Folder** for that same file. Turn **Error If Not Found** off.
Use **If** to check whether a file was returned. If it exists, offer:

- **Retry pending expense:** read it with **Get Dictionary from Input**, set
  `ExpensePayload`, and use the send/result actions below. Stop the shortcut after
  handling the result so it cannot fall through and ask for another expense.
- **Cancel:** stop and keep the file. Check the app if you are unsure whether it saved.

If no pending file exists, continue with the normal questions. You can duplicate
the send/result action block into the Retry branch. To discard a pending entry,
first check the app, then delete the file manually in Files. Never overwrite an
unresolved pending expense with a new one.

### Send the expense and read the result

Add **URL** with the deployed function URL from step 2, then **Get Contents of URL**:

- Method: **POST**.
- Header `Content-Type`: `application/json`.
- Header `X-Shortcut-Token`: your personal `et_...` token.
- Request Body: **JSON**, with the six keys from the table above. For each value,
  use **Get Dictionary Value** from `ExpensePayload`. Keep amount a Number.
- Do not send user_id, a service-role key, or the browser's public key.

After the request, read **success** using **Get Dictionary Value** and add **If**:

- If success is the Boolean **true**: delete the pending file, read **message**
  from the response, and **Speak Text** using that message.
- Otherwise: keep the pending file and speak the returned **message**.

Some HTTP/network failures stop Get Contents of URL before the If action. The
pending file must remain so the next invocation retries the same data and request
ID. Never announce success just because the shortcut reached the end. A duplicate
receipt confirms an earlier save; it does not recreate an expense deleted later.

## 5. Test on the iPhone

1. Run the shortcut manually. Allow the required network and Files permissions.
2. Save one small test expense with an existing category/payment method. Refresh
   ExpenseTracker and verify its amount, date, payment method, note, and person.
3. To check duplicate handling, reuse the exact request ID and details in a retry.
   It should say the expense was already saved, and add no second row.
4. Turn off network access and try an expense. It must retain the pending file.
   Restore connectivity and retry it. Verify exactly one row exists.
5. Say **Hey Siri, Log Expense** and answer the prompts. Test unlocked first.
   Files access and other actions may require unlocking; verify your actual device
   behavior before relying on locked-screen use.
6. Delete test expenses through the app when finished. If the phone still has a
   pending copy, clear it after checking the database; do not start a new expense
   with that pending data under a new request ID.

Do not share a configured shortcut containing your token. Share only an unconfigured
copy and have each person enroll their own token.

## Revoke a lost phone's token

In the SQL Editor, use the token record ID returned during enrollment:

```sql
update expense_tracker_private.shortcut_tokens
set revoked_at = now()
where id = 'TOKEN-RECORD-UUID';
```

Revocation blocks subsequent saves and retries with that token. Keep receipts to
preserve deduplication history. Receipts are scoped to each token: before replacing
a token, reconcile any pending file against the app. Do not retry an old pending
file under a replacement token, since that would count as a new request.
This integration does not change the app's existing
shared browser permissions: its name selector remains attribution, not login.

## Local verification

```powershell
node --test tests/app.test.cjs tests/shortcut.test.cjs
python -m unittest discover -s tests -p "test_shortcut_token.py"
```

These local tests mock Supabase and do not prove the live database or iPhone is set
up. Run the SQL test and device checks above after deployment.

References: [Apple: Siri shortcuts](https://support.apple.com/guide/shortcuts/run-shortcuts-with-siri-apd07c25bb38/ios),
[Apple: API requests](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios),
[Supabase: function configuration](https://supabase.com/docs/guides/functions/function-configuration),
[Supabase: deployment](https://supabase.com/docs/guides/functions/deploy).
