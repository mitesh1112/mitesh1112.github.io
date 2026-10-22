# Log expenses from Siri: simple setup

For SBI message automation that prepares payments for review before Save, see
[UPI_AUTOMATION_SETUP.md](./UPI_AUTOMATION_SETUP.md). Your existing Log Expense
shortcut can continue to work unchanged.

An Apple Shortcut can save through the same Supabase Data API the browser uses.
Configure your user ID once. No personal tokens, extra database tables, Edge
Function, or new migration is required. Internet access is required.

This follows the app's existing shared access model. The user ID records attribution;
it is not authentication. No browser or database permissions need changing.

## 1. Get your user ID and existing public key

In the Supabase SQL Editor, run:

```sql
select id, name from public.users order by name;
```

Copy the ID beside your name. Open app.js and copy SUPABASE_PUBLIC_KEY, which
starts with sb_publishable_. Use that public key in the shortcut. Do not use a
service-role key, secret key, database password, or the earlier et_ token.

## 2. Create Log Expense on the iPhone

Open **Shortcuts**, tap **+**, and name the shortcut **Log Expense**. Add the
following actions. Select earlier results using the variable picker, rather than
typing variable names as literal text.

| Action | Configuration |
| --- | --- |
| Ask for Input | Number; prompt: How much did you spend? |
| Set Variable | Amount = preceding answer |
| Ask for Input | Text; prompt: Which category? |
| Set Variable | Category = preceding answer |
| Ask for Input | Text; prompt: Which payment method? |
| Set Variable | PaymentMethod = preceding answer |
| Current Date, then Format Date | Custom format yyyy-MM-dd; use the phone's local timezone |
| Set Variable | ExpenseDate = formatted date |
| Choose from Menu | Save [Amount] rupees for [Category] using [PaymentMethod]? Choices: Save, Cancel |

Inside **Cancel**, add **Stop This Shortcut** (called **Stop and Output** on some
versions). Put the remaining actions inside **Save**.

Payment methods must match **UPI**, **Cash**, **Credit Card**, or **Net Banking**
exactly. For reliable selection, replace the payment prompt with **Choose from Menu**
with those four choices. In each branch, add **Text** containing the exact label,
then **Set Variable** PaymentMethod. This avoids dictation casing such as cash,
which the database rejects.

Use category labels from the browser, such as Food, Fuel, or Grocery. Direct
inserts store category text as supplied, so consistent spelling/capitalization
keeps the charts grouped correctly. A category menu can help with this too.

## 3. Save through the existing API

Add **URL** with:

```text
https://swvimqzgxhrshkfvawxd.supabase.co/rest/v1/expenses
```

Use this Data API address, rather than /functions/v1/log-expense.

Add **Get Contents of URL**, expand its options, and configure:

- Method: **POST**.
- Headers:
  - apikey: the SUPABASE_PUBLIC_KEY value from app.js.
  - Content-Type: application/json.
  - Prefer: return=representation.
- Request Body: **JSON**, with these fields:

| Key | Type | Value |
| --- | --- | --- |
| user_id | Text | Your existing user UUID, entered as fixed text |
| date | Text | ExpenseDate variable |
| amount | Number | Amount variable |
| category | Text | Category variable |
| payment_method | Text | PaymentMethod variable |
| note | Text | Empty text, or a note you choose to enter |

No Authorization header is needed with the publishable key and the existing
anonymous insert policy. The database generates the expense ID; there is no request
ID to configure.

## 4. Confirm the result

Prefer: return=representation returns the inserted row as a JSON array. This
response does not have the earlier Edge Function's success or message fields.

After **Get Contents of URL**, add:

1. **Set Variable**: name SaveResponse; input explicitly selected from **Contents of URL**.
2. **Get Item from List**: first item of **SaveResponse**.
3. **Get Dictionary Value**: key id from the **Item from List** result.
4. **Set Variable**: name SavedExpenseID; input the preceding **Dictionary Value**.
5. **If SavedExpenseID has any value**: **Speak Text**: Expense saved.
6. **Otherwise**: **Speak Text**: Could not confirm the save. Please check ExpenseTracker.

Explicitly select those inputs with the variable picker. Do not let the If action
use Amount, Category, a menu result, or another earlier variable.

An HTTP/network failure may stop the shortcut before those actions. Do not add an
automatic retry: a response can be lost after the expense has saved. Check the app
before logging an expense again if its outcome is uncertain. This simpler setup
does not provide automatic duplicate prevention or per-device token revocation.

### If the shortcut reaches Otherwise

This only means the shortcut did not extract an ID. It does not establish whether
the expense was saved. First check the app before sending the expense again.

Temporarily insert **Show Result** immediately after **Set Variable SaveResponse**,
with **SaveResponse** explicitly selected as its input. Keep the subsequent
**Get Item from List** connected to SaveResponse, not the Show Result output.
Run one test manually and inspect that raw response:

- A JSON array containing a row with id: the API returned a saved row. Check the
  input variables for Get Item from List, Get Dictionary Value, and If as above.
- An error object containing code, message, details, or hint: use that exact error
  to diagnose the request; do not assume the problem is the If action.
- Empty output: confirm the header name is Prefer and its value is exactly
  return=representation. Without this preference, a successful insert normally
  returns no body. Check the app before retrying.

Also confirm the URL ends in /rest/v1/expenses, rather than the earlier Edge
Function address. An Edge Function response has a different shape.

Share the raw response text when asking for help; user_id, notes, and amounts may
be redacted. API keys and request headers are not needed for this diagnosis.

## 5. Test, then use Siri

Run manually first and allow network access. Save a small test expense, refresh
ExpenseTracker, and check its person, amount, date, category, and payment method.
Delete the test expense through the app afterwards.

Then say **Hey Siri, Log Expense** and answer the prompts. Test unlocked first;
some prompts/actions may require unlocking depending on your iPhone's settings.

## About the setup already deployed

The existing log-expense function, token records, and migration 06 are unused by
this approach. You do not need to undo them to continue. No remote objects have
been deleted as part of this change.

The earlier instructions are preserved in [SIRI_SETUP_ADVANCED.md](./SIRI_SETUP_ADVANCED.md)
as an optional reference. Follow this document for the simple setup.

References: [Supabase Data API](https://supabase.com/docs/guides/api/creating-routes),
[publishable keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Apple Shortcuts API requests](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios).
