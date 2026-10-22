# SBI UPI messages: prepare now, review and save later

This builds on your working Siri shortcut, using the same public Supabase key and
fixed user ID. It does not use personal shortcut tokens or the earlier Edge Function.

The flow is: **incoming SBI SMS → pending draft → review in ExpenseTracker → Save**.
Each payment stays separate. Pending and dismissed drafts never count in totals.
This version supports the SBI debit format in your screenshots; credit-card
messages and other banks are not included yet.

## 1. Apply the new database migration

Open your [Supabase SQL Editor](https://supabase.com/dashboard/project/swvimqzgxhrshkfvawxd/sql/new).
Run the full contents of `supabase/07_upi_drafts.sql` once. Schema migrations 01,
02, 03, and 05 must already be applied, as for your existing tracker. Migration 06
is not required. Do not rerun the initial table-creation scripts.

Then run `tests/upi_drafts_database.sql` in a separate query. It verifies both
sample messages, duplicate handling, reviewed saves, dismissal, and permissions.
All its test rows are rolled back. If it fails, run `ROLLBACK;` and resolve the
error before continuing.

Publish the updated `app.js` and `index.html` through your usual GitHub Pages
process. This repository change does not itself apply SQL or publish the site.

## 2. Check a draft in the app first

Open the updated tracker and select Mitesh. Tap **Pending payments** in the header;
the badge shows how many payments are waiting. The **Pending UPI payments** dialog
opens without moving the manual expense form down the page. Close it with **Close**
or Escape. Selecting **Review** closes the dialog and fills the expense form.
Expand **Prepare a draft from an SBI message**, paste one complete message, and
press **Prepare draft**. This does not save an expense.

The parser extracts the payment date from the SMS, not its delivery date, along
with the amount, recipient, masked account, and transaction reference. It stores
the recipient and reference in the note. The full SMS is not stored.

For the SKY CHEMIST sample, press **Review**. The form should contain:

| Field | Prepared value |
| --- | --- |
| Date | 2026-10-21 |
| Amount | 56.00 |
| Category | Medicine (suggestion; editable) |
| Payment method | UPI |
| Note | M/S.SKY CHEMIST followed by the UPI reference |

Check or edit the values, then press **Save expense**. Only this step records
spending. The draft disappears from Pending and the expense appears in the feed.
For an unknown recipient such as RAJESH MANEK, choose the category during review.
You can **Leave review** to keep a payment pending, or **Dismiss** to exclude it.
Dismiss transfers to your own accounts or payments you already recorded manually.

Repeating the same SMS for the same user will not create a second draft, even
after saving or dismissing it. Conflicting details under the same reference are
rejected. Retrying a Save request cannot create a second expense from that draft.
This cannot detect an expense separately entered through your ordinary Siri
shortcut; review/dismiss those drafts to avoid recording the same payment twice.

## 3. Create a new shortcut: Prepare SBI UPI Draft

Keep your working **Log Expense** shortcut unchanged. Create a second shortcut,
named **Prepare SBI UPI Draft**, with these actions:

1. **Get Text from Input**, explicitly using **Shortcut Input**. For a Message
   automation, select the incoming message's **Content** property if Shortcuts
   presents it as a Message object. The text must start with `Dear UPI user`, not
   the sender name or the message's date. Save this text as **MessageText**.
2. Add **URL**:

   ```text
   https://swvimqzgxhrshkfvawxd.supabase.co/rest/v1/rpc/queue_sbi_upi_message
   ```

3. Add **Get Contents of URL**:

   - Method: **POST**.
   - Header `apikey`: the same public key from app.js that works in Log Expense.
   - Header `Content-Type`: `application/json`.
   - Request Body: **JSON**:

   | Key | Type | Value |
   | --- | --- | --- |
   | p_user_id | Text | Mitesh's user UUID, fixed text as in Log Expense |
   | p_message | Text | MessageText variable |

   Key names must have no leading or trailing spaces. There is no expense insert
   here and no category/amount question. The function parses the message for you.

4. **Set Variable**: **DraftResponse**, from **Contents of URL**.
5. **Get Dictionary Value**: `success` from DraftResponse.
6. **If** success is Boolean **true**:

   - Read `duplicate` from DraftResponse. If false, **Show Notification**:
     `UPI draft ready. Open ExpenseTracker to review and save.`
   - Optionally include `amount` and `recipient` from DraftResponse in the notice.
   - A duplicate needs no new notification: it may already be saved or dismissed.

7. **Otherwise**: read `message` from DraftResponse and **Show Notification** with
   that error. Do not show a success notice unconditionally.

Unlike your direct expense insert, this response is a JSON **object**, not an
array: do not add Get First Item from List. No Prefer header is required.

To test without waiting for an SMS, temporarily add a **Text** action containing
one complete sample message at the start and use it as MessageText. Display
DraftResponse with **Show Result** while testing. Afterwards remove that Text
action and restore the input from Shortcut Input.

## 4. Connect the incoming-message automation

In Shortcuts, create a personal automation with the **Message** trigger. Depending
on iOS, use the Automation tab or add a message automation trigger. Set:

- **Message Contains**: `Dear UPI user`.
- Optionally restrict **Sender** to the SBI sender if your phone allows selecting
  it. Your screenshot shows `JD-SBIUPI-S`; bank sender prefixes can vary. If it is
  not selectable, use the text condition alone. The parser still requires the
  specific complete SBI debit format.
- **Run Immediately**, or turn off confirmation before running if that is the
  equivalent setting on your iOS version.

Add **Run Shortcut → Prepare SBI UPI Draft** and explicitly pass the incoming
message / its Content as the shortcut's input. The parser must receive the SMS
body, not an empty value. If needed, put **Get Text from Input** using the incoming
message's Content before Run Shortcut and pass that result.

Allow network access during an initial manual test. Do not add Open App, Ask for
Input, or Show Result to the production automation; it should prepare a draft in
the background. You open the tracker to review when convenient. The notification
is informational; it is not a Save button and does not automatically open a draft.

Check a real incoming SBI UPI debit when convenient. No payment needs to be made
solely for testing. Existing messages are not scanned retrospectively; paste them
using the app's manual draft option if needed. Test locked-screen behavior on your
actual iPhone before relying on it.

## Reliability and troubleshooting

- **Offline or automation/network failure:** the message remains in Messages, but
  no background retry is guaranteed. Open the tracker later and paste that SMS to
  prepare the draft. The same SMS can safely be submitted again.
- **No draft appears:** select the user configured in the shortcut, tap
  **Pending payments**, then **Refresh pending**. Returning to the browser also
  refreshes the queue and the button's count.
- **Unsupported message:** this version accepts only a single complete SBI UPI
  debit alert with a numeric amount, DDMonYY date, recipient, and numeric Refno.
  Credits, OTPs, failure alerts, invalid dates, and multiple pasted SMSes are rejected.
- **Draft missing after a save/dismiss:** this is expected. References are retained
  so receiving the message again cannot restore a resolved draft.
- **Shared access:** names remain attribution, not login. The existing public key
  is used; no new identity system or per-phone credential is introduced.

Reference: [Apple's message automation triggers](https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios).
