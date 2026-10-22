// Optional PostgreSQL-in-WASM validation; dependency is installed outside the app.
// node tests/run_upi_database.cjs <path-to-@electric-sql/pglite>
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    for (const migration of ['01_expenses.sql', '02_users_and_delete.sql', '03_users_table.sql',
      '05_payment_method.sql', '07_upi_drafts.sql']) {
      await db.exec(fs.readFileSync(path.join(__dirname, '..', 'supabase', migration), 'utf8'));
    }
    await db.exec(fs.readFileSync(path.join(__dirname, 'upi_drafts_database.sql'), 'utf8'));
    console.log('UPI database checks passed: both sample messages, validation, duplicate references, reviewed saves, retries, dismissal, permissions.');
  } finally { await db.close(); }
})().catch(error => { console.error(error.message, error.where || ''); process.exitCode = 1; });
