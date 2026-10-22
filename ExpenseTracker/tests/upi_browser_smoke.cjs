// Local UI + PostgreSQL smoke test. Dependencies live outside the static app.
// node tests/upi_browser_smoke.cjs <temporary-node_modules-folder> <artifact-folder>
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const modules = process.argv[2];
const { PGlite } = require(path.join(modules, '@electric-sql/pglite'));
const { chromium } = require(path.join(modules, 'playwright'));

(async () => {
  const root = path.join(__dirname, '..');
  const db = new PGlite();
  let browser;
  let server;
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    for (const file of ['01_expenses.sql', '02_users_and_delete.sql', '03_users_table.sql', '05_payment_method.sql', '07_upi_drafts.sql']) {
      await db.exec(fs.readFileSync(path.join(root, 'supabase', file), 'utf8'));
    }
    const user = (await db.query("select id from public.users where name = 'Mitesh'")).rows[0].id;
    const first = 'Dear UPI user A/C X5901 debited by 56.00 on date 21Oct26 trf to M/S.SKY CHEMIST Refno 210727313985 If not u? call-1800111109 for other services-18001234-SBI';
    const second = 'Dear UPI user A/C X5901 debited by 50.00 on date 22Oct26 trf to Mr RAJESH MANEK Refno 104219318709 If not u? call-1800111109 for other services-18001234-SBI';
    await db.exec('set role anon');
    for (const message of [first, second]) await db.query('select public.queue_sbi_upi_message($1, $2)', [user, message]);
    server = http.createServer((req, res) => {
      const name = req.url === '/ExpenseTracker/' ? 'index.html' : req.url.replace('/ExpenseTracker/', '');
      if (!['index.html', 'app.js'].includes(name)) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/html');
      res.end(fs.readFileSync(path.join(root, name)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/supabase-js/, route => route.fulfill({ contentType: 'application/javascript', body: '/* local SQL adapter */' }));
    await page.route(/chart\.umd/, route => route.fulfill({ contentType: 'application/javascript', body: '/* exercise accessible chart fallback */' }));
    if (process.argv[3] && fs.existsSync(path.join(process.argv[3], 'tailwind.css'))) {
      const css = fs.readFileSync(path.join(process.argv[3], 'tailwind.css'), 'utf8');
      await page.route('https://cdn.tailwindcss.com/', route => route.fulfill({ contentType: 'application/javascript',
        body: `document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(css)} }));` }));
    }
    await page.exposeFunction('upiTestQuery', async ({ table, filters, orders, start, end }) => {
      assert.ok(['users', 'expenses', 'upi_drafts'].includes(table));
      const values = [];
      const conditions = filters.map(({ op, column, value }) => {
        assert.ok(['=', '>=', '<', '<='].includes(op));
        assert.ok(['id', 'date', 'user_id', 'status'].includes(column));
        values.push(value);
        return `${column} ${op} $${values.length}`;
      });
      const where = conditions.length ? ` where ${conditions.join(' and ')}` : '';
      const count = (await db.query(`select count(*)::integer as n from public.${table}${where}`, values)).rows[0].n;
      const order = orders.map(({ column, ascending }) => {
        assert.ok(['id', 'name', 'date', 'created_at'].includes(column));
        return `${column} ${ascending ? 'asc' : 'desc'}`;
      }).join(', ');
      const rows = (await db.query(`select * from public.${table}${where}${order ? ' order by ' + order : ''} limit ${end - start + 1} offset ${start}`, values)).rows;
      for (const row of rows) if (row.date instanceof Date) row.date = row.date.toISOString().slice(0, 10);
      if (table === 'expenses') {
        const users = (await db.query('select id,name from public.users')).rows;
        for (const row of rows) row.user = users.find(person => person.id === row.user_id) || null;
      }
      return { data: rows, error: null, count };
    });
    await page.exposeFunction('upiTestRpc', async (name, params) => {
      const signatures = { queue_sbi_upi_message: ['p_user_id', 'p_message'], save_upi_draft:
        ['p_draft_id', 'p_date', 'p_amount', 'p_category', 'p_payment_method', 'p_note'], dismiss_upi_draft: ['p_draft_id'] };
      assert.ok(signatures[name]);
      const values = signatures[name].map(key => params[key]);
      try {
        const result = await db.query(`select public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) as data`, values);
        return { data: result.rows[0].data, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    });
    await page.addInitScript(() => {
      window.supabase = { createClient: () => ({ rpc: (name, params) => window.upiTestRpc(name, params), from(table) {
        const filters = [], orders = [];
        const query = { select() { return query; }, order(column, options) { orders.push({ column, ...options }); return query; },
          eq(column, value) { filters.push({ op: '=', column, value }); return query; },
          gte(column, value) { filters.push({ op: '>=', column, value }); return query; },
          lt(column, value) { filters.push({ op: '<', column, value }); return query; },
          lte(column, value) { filters.push({ op: '<=', column, value }); return query; },
          range(start, end) { return window.upiTestQuery({ table, filters, orders, start, end }); } };
        return query;
      } }) };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/ExpenseTracker/`);
    await page.selectOption('#active-user', user);
    await page.waitForFunction(() => document.querySelectorAll('#draft-list > li').length === 2);
    await page.waitForFunction(() => !document.querySelector('#submit-expense').disabled);
    assert.equal(await page.locator('#pending-expenses').isVisible(), false, 'Pending queue must not push the form down');
    assert.equal(await page.textContent('#pending-count'), '2');
    if (process.argv[3]) { fs.mkdirSync(process.argv[3], { recursive: true }); await page.screenshot({ path: path.join(process.argv[3], 'upi-iphone.png'), fullPage: true }); }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow on iPhone width');
    await page.fill('#expense-amount', '12');
    await page.click('#open-pending');
    await page.waitForFunction(() => document.querySelector('#pending-expenses').open);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#pending-expenses').open);
    assert.equal(await page.inputValue('#expense-amount'), '12', 'Closing the dialog preserves manual entries');
    await page.fill('#expense-amount', '');
    await page.click('#open-pending');
    await page.waitForFunction(() => !document.querySelector('#refresh-drafts').disabled);
    if (process.argv[3]) await page.screenshot({ path: path.join(process.argv[3], 'upi-pending-dialog.png') });
    await page.locator('#draft-list > li').filter({ hasText: 'SKY CHEMIST' }).locator('button').filter({ hasText: 'Review' }).click();
    assert.equal(await page.locator('#pending-expenses').isVisible(), false, 'Review must return to the form');
    assert.equal(Number(await page.inputValue('#expense-amount')), 56);
    assert.equal(await page.inputValue('#expense-date'), '2026-10-21');
    assert.equal(await page.inputValue('#expense-category'), 'Medicine');
    await page.click('#submit-expense');
    await page.waitForFunction(() => document.querySelector('#draft-review').hidden && document.querySelectorAll('#expense-list > li').length === 1);
    assert.equal((await db.query('select count(*)::integer as n from public.expenses')).rows[0].n, 1);
    assert.equal(await page.textContent('#pending-count'), '1');
    await db.query('select public.queue_sbi_upi_message($1, $2)', [user, first]);
    await page.click('#open-pending');
    await page.waitForFunction(() => !document.querySelector('#refresh-drafts').disabled);
    await page.click('#refresh-drafts');
    await page.waitForFunction(() => document.querySelectorAll('#draft-list > li').length === 1);
    await page.locator('#draft-list button').filter({ hasText: 'Review' }).click();
    assert.equal(await page.inputValue('#expense-category'), '');
    await page.selectOption('#expense-category', 'Other');
    await page.click('#submit-expense');
    await page.waitForFunction(() => document.querySelector('#draft-review').hidden && document.querySelectorAll('#expense-list > li').length === 2);
    assert.equal(await page.textContent('#pending-count'), '0');
    for (const [width, height, label] of [[412, 915, 'android'], [1366, 900, 'desktop']]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow at ${label} width`);
      if (process.argv[3]) await page.screenshot({ path: path.join(process.argv[3], `upi-${label}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('Browser + SQL smoke passed: iPhone, Android and desktop widths; two drafts reviewed and saved; no automatic expense inserts or duplicate SMS imports.');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
