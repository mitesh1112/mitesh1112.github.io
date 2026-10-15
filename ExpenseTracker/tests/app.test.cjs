const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(`${__dirname}/../app.js`, 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const defaultUsers = () => ['Mitesh', 'Neha', 'Brinda', 'Harshal'].map(name => ({ id: `id-${name}`, name }));

async function boot({ rows = [], userRows = defaultUsers(), userReadError = false, chartAvailable = true, date = '2026-10-15T12:00:00', readError = false, rememberedUser = 'Mitesh', storage, blockedStorage = false } = {}) {
  const nodes = {};
  const charts = [];
  const inserts = [];
  const deletes = [];
  const feedRequests = [];
  const monthlyRequests = [];
  let failMonthly = false;
  storage ||= new Map(rememberedUser ? [['expense-tracker.active-user', rememberedUser]] : []);
  let confirmDelete = true;
  let deleteMode = 'success';
  let confirmText = '';
  let failRead = readError;
  let failUserRead = userReadError;
  let failInsert = false;
  let failAfterInsert = false;
  class Element {
    constructor() {
      this.value = ''; this.children = []; this.disabled = true;
      this.listeners = {}; this.attributes = {}; this.style = {}; this.parts = {};
      this.classList = { toggle() {} };
    }
    append(...items) { this.children.push(...items); }
    replaceChildren(fragment) { this.children = fragment.children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    querySelector(selector) { return this.parts[selector] ||= new Element(); }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    reportValidity() { return true; }
    focus() {}
    reset() {
      for (const id of ['expense-date', 'expense-amount', 'expense-category', 'expense-note']) nodes[id].value = '';
    }
  }
  class FakeChart {
    constructor(canvas, config) { this.data = config.data; this.config = config; this.updates = 0; charts.push(this); }
    update() { this.updates++; }
    destroy() { this.destroyed = true; }
  }
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [date])); }
  }
  const document = {
    getElementById(id) { return nodes[id] ||= new Element(); },
    createElement() { return new Element(); },
    createDocumentFragment() { return new Element(); },
    addEventListener() {},
  };
  const client = { from(table) {
    assert.ok(['users', 'expenses'].includes(table));
    let deleting = false;
    let deleteId;
    let fields;
    const filters = [];
    const query = {
      select(selection) {
        fields = selection;
        if (!deleting) return query;
        return (async () => {
          deletes.push(deleteId);
          if (deleteMode === 'error') return { error: { code: '42501' } };
          if (deleteMode === 'zero') return { data: [], error: null };
          const index = rows.findIndex(row => row.id === deleteId);
          if (index < 0) return { data: [], error: null };
          rows.splice(index, 1);
          return { data: [{ id: deleteId }], error: null };
        })();
      },
      delete() { deleting = true; return query; },
      eq(column, value) { assert.equal(column, 'id'); deleteId = value; return query; },
      order() { return query; },
      gte(column, value) { filters.push(row => row[column] >= value); return query; },
      lt(column, value) { filters.push(row => row[column] < value); return query; },
      async range(start, end) {
        if (table === 'users') {
          if (failUserRead) return { error: { code: 'PGRST205' } };
          return { data: userRows.slice(start, start + 2), error: null };
        }
        if (failRead) return { error: { code: '42501' } };
        if (fields === 'id,date,amount,category') {
          monthlyRequests.push({ start, end });
          if (failMonthly) return { error: { code: '42501' } };
          assert.equal(filters.length, 2, 'dashboard queries must be restricted to the month');
          return { data: rows.filter(row => filters.every(filter => filter(row))).slice(start, Math.min(end + 1, start + 2)), error: null };
        }
        feedRequests.push({ start, end });
        return { data: rows.slice(start, end + 1).map(row => ({ ...row,
          user: userRows.find(user => user.id === row.user_id) || null,
        })), error: null, count: rows.length };
      },
      async insert(payload) {
        inserts.push(payload);
        if (failInsert) return { error: { code: '42501' } };
        rows.unshift({ ...payload, id: 'new', created_at: '' });
        if (failAfterInsert) failRead = true;
        return { error: null };
      },
    };
    return query;
  } };
  vm.runInNewContext(source, {
    document, Date: FixedDate, Intl,
    window: {
      supabase: { createClient: () => client }, Chart: chartAvailable ? FakeChart : undefined,
      confirm(text) { confirmText = text; return confirmDelete; },
      localStorage: {
        getItem(key) { if (blockedStorage) throw Error('Storage blocked'); return storage.get(key) || null; },
        setItem(key, value) { if (blockedStorage) throw Error('Storage blocked'); storage.set(key, value); },
        removeItem(key) { if (blockedStorage) throw Error('Storage blocked'); storage.delete(key); },
      },
    },
  });
  await settle();
  return {
    nodes, charts, inserts, deletes, storage, feedRequests, monthlyRequests,
    switchUser(value) { nodes['active-user'].value = userRows.find(user => user.name === value)?.id || value; nodes['active-user'].listeners.change(); },
    remove(index = 0) { return nodes['expense-list'].children[index].children[1].children[1].listeners.click(); },
    setDeleteMode(mode) { deleteMode = mode; },
    setConfirm(value) { confirmDelete = value; },
    confirmation: () => confirmText,
    filter(value) { nodes['expense-search'].value = value; nodes['expense-search'].listeners.input(); },
    refresh: () => nodes['refresh-expenses'].listeners.click(),
    loadMore: () => nodes['load-more-expenses'].listeners.click(),
    setMonthlyError(value) { failMonthly = value; },
    setReadError(value) { failRead = value; },
    setUserReadError(value) { failUserRead = value; },
    setInsertError(value) { failInsert = value; },
    setRefreshErrorAfterInsert() { failAfterInsert = true; },
    save() {
      nodes['expense-date'].value = '2026-10-15';
      nodes['expense-amount'].value = '5.00';
      nodes['expense-category'].value = 'Groceries';
      nodes['expense-note'].value = '  Milk  ';
      return nodes['expense-form'].listeners.submit({ preventDefault() {} });
    },
  };
}

const expense = (date, amount, category, note = '') => ({ id: date + amount, date, amount, category, note, created_at: '' });

test('search matches category, note, ISO date and displayed date without changing monthly totals', async () => {
  const app = await boot({ rows: [
    expense('2026-10-15', '0.10', 'Food & Dining', 'Lunch'),
    expense('2026-10-14', '0.20', 'Food & Dining', '<script>alert(1)</script>'),
    expense('2026-10-01', '12.50', 'Transport', 'Train'),
    expense('2026-09-30', '999.00', 'Other', 'Last month'),
    expense('2026-11-01', '888.00', 'Other', 'Next month'),
  ] });
  const { nodes, charts } = app;
  assert.equal(nodes['expense-list'].children.length, 5);
  assert.equal(nodes['monthly-total'].textContent, '₹12.80');
  assert.equal(charts[0].config.type, 'pie');
  assert.deepEqual(Array.from(charts[0].data.datasets[0].data), [12.5, 0.3]);
  for (const [query, count] of [['  FOOD  ', 2], ['lunch', 1], ['2026-10', 3], ['15 Oct 2026', 1], ['last month', 1], ['missing', 0]]) {
    app.filter(query);
    assert.equal(nodes['expense-list'].children.length, count);
    assert.equal(nodes['monthly-total'].textContent, '₹12.80');
    assert.equal(charts.length, 1);
  }
  assert.equal(nodes['feed-empty-state'].hidden, false);
  assert.equal(nodes['feed-empty-state'].querySelector('h3').textContent, 'No matching expenses');
  app.filter('script');
  assert.equal(nodes['expense-list'].children[0].children[0].children[2].textContent, '<script>alert(1)</script>');
  app.filter('');
  assert.equal(nodes['expense-list'].children.length, 5);
});

test('save updates chart and totals, retains search, and prevents duplicate submission', async () => {
  const app = await boot({ rows: [expense('2026-10-15', '10.00', 'Other')] });
  app.filter('Milk');
  const saving = app.save();
  await app.save();
  await saving;
  assert.equal(app.inserts.length, 1);
  assert.equal(app.inserts[0].note, 'Milk');
  assert.equal(app.nodes['monthly-total'].textContent, '₹15.00');
  assert.equal(app.nodes['expense-search'].value, 'Milk');
  assert.equal(app.nodes['expense-list'].children.length, 1);
  assert.equal(app.charts.length, 1);
  assert.equal(app.charts[0].updates, 1);
});

test('empty month displays zero and removes a previous chart', async () => {
  const rows = [expense('2026-10-01', '2.00', 'Other')];
  const app = await boot({ rows });
  rows.length = 0;
  await app.refresh();
  assert.equal(app.nodes['monthly-total'].textContent, '₹0.00');
  assert.equal(app.nodes['category-chart'].hidden, true);
  assert.equal(app.nodes['chart-empty-state'].hidden, false);
  assert.equal(app.charts[0].destroyed, true);
});

test('year boundary excludes expenses in adjacent calendar months', async () => {
  const app = await boot({ date: '2027-01-01T00:01:00', rows: [
    expense('2026-12-31', '100.00', 'Other'), expense('2027-01-01', '1.00', 'Other'),
  ] });
  assert.equal(app.nodes['monthly-total'].textContent, '₹1.00');
});

test('unavailable Chart.js preserves totals, category text and search', async () => {
  const app = await boot({ chartAvailable: false, rows: [expense('2026-10-01', '2.00', 'Other')] });
  assert.equal(app.nodes['monthly-total'].textContent, '₹2.00');
  assert.equal(app.nodes['category-breakdown'].children.length, 1);
  assert.match(app.nodes['chart-empty-state'].querySelector('p').textContent, /Chart unavailable/);
  app.filter('other');
  assert.equal(app.nodes['expense-list'].children.length, 1);
});

test('failed refresh preserves data and its warning during search; retry recovers', async () => {
  const app = await boot({ rows: [expense('2026-10-01', '2.00', 'Other')] });
  app.setReadError(true);
  await app.refresh();
  app.filter('Other');
  assert.match(app.nodes['feed-status'].textContent, /Showing previously loaded data/);
  assert.equal(app.nodes['monthly-total'].textContent, '₹2.00');
  app.setReadError(false);
  await app.refresh();
  assert.doesNotMatch(app.nodes['feed-status'].textContent, /Could not load/);
});

test('initial read failure leaves totals unavailable and search disabled', async () => {
  const app = await boot({ readError: true });
  assert.equal(app.nodes['expense-search'].disabled, true);
  assert.equal(app.charts.length, 0);
  assert.match(app.nodes['feed-status'].textContent, /Could not load/);
});

test('failed insert preserves entries; failed refresh after insert reports saved', async () => {
  const app = await boot();
  app.setInsertError(true);
  await app.save();
  assert.equal(app.nodes['expense-note'].value, '  Milk  ');
  assert.match(app.nodes['form-status'].textContent, /entries are preserved/);
  app.setInsertError(false);
  app.setRefreshErrorAfterInsert();
  await app.save();
  assert.equal(app.nodes['expense-note'].value, '');
  assert.match(app.nodes['form-status'].textContent, /Expense saved, but the feed could not refresh/);
});

test('a name is required, remembered, and attached to each new expense', async () => {
  const app = await boot({ rememberedUser: '' });
  assert.equal(app.nodes['submit-expense'].disabled, true);
  await app.save();
  assert.equal(app.inserts.length, 0);
  for (const name of ['Mitesh', 'Neha', 'Brinda', 'Harshal']) {
    app.switchUser(name);
    await app.save();
    assert.equal(app.inserts.at(-1).user_id, `id-${name}`);
    assert.equal('added_by' in app.inserts.at(-1), false);
  }
  const reopened = await boot({ storage: app.storage });
  assert.equal(reopened.nodes['active-user'].value, 'id-Harshal');
  assert.equal(reopened.nodes['submit-expense'].disabled, false);
});

test('switching names preserves the draft and does not change earlier attribution or shared totals', async () => {
  const app = await boot({ rows: [{ ...expense('2026-10-01', '2.00', 'Other'), user_id: 'id-Neha' }] });
  app.nodes['expense-note'].value = 'Draft';
  app.switchUser('Brinda');
  assert.equal(app.nodes['expense-note'].value, 'Draft');
  assert.equal(app.nodes['monthly-total'].textContent, '₹2.00');
  app.filter('neha');
  assert.equal(app.nodes['expense-list'].children.length, 1);
  assert.equal(app.nodes['expense-list'].children[0].children[0].children.at(-1).textContent, 'Added by: Neha');
  app.filter('brinda');
  assert.equal(app.nodes['expense-list'].children.length, 0);
});

test('legacy expenses show Not recorded without assigning them to the selected person', async () => {
  const app = await boot({ rows: [expense('2026-10-01', '2.00', 'Other')] });
  assert.equal(app.nodes['expense-list'].children[0].children[0].children.at(-1).textContent, 'Added by: Not recorded');
  app.filter('not recorded');
  assert.equal(app.nodes['expense-list'].children.length, 1);
});

test('invalid saved names are ignored and blocked storage still allows switching and saving', async () => {
  const invalid = await boot({ rememberedUser: 'Unknown' });
  assert.equal(invalid.nodes['active-user'].value, '');
  assert.equal(invalid.nodes['submit-expense'].disabled, true);
  const app = await boot({ blockedStorage: true });
  app.switchUser('Neha');
  assert.match(app.nodes['user-status'].textContent, /storage is unavailable/);
  await app.save();
  assert.equal(app.inserts[0].user_id, 'id-Neha');
});

test('canceling delete sends no request', async () => {
  const app = await boot({ rows: [expense('2026-10-01', '2.00', 'Other')] });
  app.setConfirm(false);
  await app.remove();
  assert.equal(app.deletes.length, 0);
  assert.equal(app.nodes['expense-list'].children.length, 1);
  assert.match(app.confirmation(), /permanently removes the expense for everyone/);
});

test('confirmed delete targets one ID, guards duplicates, and updates filtered feed and dashboard', async () => {
  const row = { ...expense('2026-10-01', '2.00', 'Other'), user_id: 'id-Harshal' };
  const app = await boot({ rows: [row, expense('2026-10-02', '3.00', 'Other')] });
  app.filter('Harshal');
  const removing = app.remove();
  await app.remove();
  await removing;
  assert.deepEqual(app.deletes, [row.id]);
  assert.equal(app.nodes['expense-list'].children.length, 0);
  assert.equal(app.nodes['monthly-total'].textContent, '₹3.00');
  assert.equal(app.nodes['expense-search'].value, 'Harshal');
  assert.equal(app.nodes['expense-action-status'].textContent, 'Expense deleted.');
});

test('deleting the last expense clears the chart and displays empty state', async () => {
  const app = await boot({ rows: [expense('2026-10-01', '2.00', 'Other')] });
  await app.remove();
  assert.equal(app.nodes['monthly-total'].textContent, '₹0.00');
  assert.equal(app.nodes['feed-empty-state'].hidden, false);
  assert.equal(app.charts[0].destroyed, true);
});

test('permission failures and zero-row deletes preserve data and show useful errors', async () => {
  for (const mode of ['error', 'zero']) {
    const app = await boot({ rows: [expense('2026-10-01', '2.00', 'Other')] });
    app.setDeleteMode(mode);
    await app.remove();
    assert.equal(app.nodes['expense-list'].children.length, 1);
    assert.equal(app.nodes['monthly-total'].textContent, '₹2.00');
    assert.match(app.nodes['expense-action-status'].textContent, /02_users_and_delete.sql/);
    assert.equal(app.nodes['refresh-expenses'].disabled, false);
  }
});

test('switcher loads arbitrary users from the database and saves their IDs', async () => {
  const userRows = [{ id: 'db-user-42', name: 'A new person <script>' }];
  const app = await boot({ userRows, rememberedUser: '' });
  assert.equal(app.nodes['active-user'].children.length, 2);
  assert.equal(app.nodes['active-user'].children[1].textContent, 'A new person <script>');
  app.switchUser('db-user-42');
  await app.save();
  assert.equal(app.inserts[0].user_id, 'db-user-42');
  assert.equal(app.nodes['expense-list'].children[0].children[0].children.at(-1).textContent,
    'Added by: A new person <script>');
});

test('refresh picks up added and renamed users while retaining selection by ID', async () => {
  const userRows = [{ id: 'person-1', name: 'Original name' }];
  const app = await boot({ userRows, rememberedUser: 'person-1', rows: [
    { ...expense('2026-10-01', '2.00', 'Other'), user_id: 'person-1' },
  ] });
  userRows[0].name = 'Updated name';
  userRows.push({ id: 'person-2', name: 'Another person' });
  await app.refresh();
  assert.equal(app.nodes['active-user'].children.length, 3);
  assert.equal(app.nodes['active-user'].value, 'person-1');
  assert.match(app.nodes['user-status'].textContent, /Updated name/);
  app.filter('Updated name');
  assert.equal(app.nodes['expense-list'].children.length, 1);
  const reopened = await boot({ userRows, storage: app.storage });
  assert.equal(reopened.nodes['active-user'].value, 'person-1');
});

test('empty users table disables saving and explains how to add users', async () => {
  const app = await boot({ userRows: [] });
  assert.equal(app.nodes['active-user'].disabled, true);
  assert.equal(app.nodes['submit-expense'].disabled, true);
  assert.match(app.nodes['user-status'].textContent, /No users available/);
  await app.save();
  assert.equal(app.inserts.length, 0);
});

test('failed users fetch blocks saving and recovers through refresh', async () => {
  const app = await boot({ userReadError: true });
  assert.equal(app.nodes['active-user'].disabled, true);
  assert.equal(app.nodes['submit-expense'].disabled, true);
  assert.match(app.nodes['user-status'].textContent, /03_users_table.sql/);
  app.setUserReadError(false);
  await app.refresh();
  assert.equal(app.nodes['active-user'].value, 'id-Mitesh');
  assert.equal(app.nodes['submit-expense'].disabled, false);
});

test('removed selection is cleared and old remembered names are upgraded to IDs', async () => {
  const userRows = [{ id: 'person-1', name: 'Legacy name' }];
  const app = await boot({ userRows, rememberedUser: 'Legacy name' });
  assert.equal(app.storage.get('expense-tracker.active-user'), 'person-1');
  userRows.splice(0, 1, { id: 'person-2', name: 'Different person' });
  await app.refresh();
  assert.equal(app.nodes['active-user'].value, '');
  assert.equal(app.nodes['submit-expense'].disabled, true);
});

const manyExpenses = (count) => Array.from({ length: count }, (_, index) => ({
  ...expense('2026-10-01', '1.00', 'Other', `Expense ${index}`),
  id: `expense-${index}`, created_at: `timestamp-${index}`,
}));

test('feed fetches exactly one page at a time, then hides Load more at the end', async () => {
  const app = await boot({ rows: manyExpenses(125) });
  assert.equal(app.nodes['expense-list'].children.length, 50);
  assert.deepEqual(app.feedRequests, [{ start: 0, end: 49 }]);
  assert.equal(app.nodes['load-more-expenses'].hidden, false);
  assert.match(app.nodes['feed-status'].textContent, /50 of 125 expenses loaded/);
  assert.equal(app.nodes['monthly-total'].textContent, '₹125.00', 'dashboard includes unloaded current-month expenses');
  const summaryRequests = app.monthlyRequests.length;
  await app.loadMore();
  assert.equal(app.nodes['expense-list'].children.length, 100);
  assert.deepEqual(app.feedRequests.at(-1), { start: 50, end: 99 });
  await app.loadMore();
  assert.equal(app.nodes['expense-list'].children.length, 125);
  assert.deepEqual(app.feedRequests.at(-1), { start: 100, end: 149 });
  assert.equal(app.nodes['load-more-expenses'].hidden, true);
  assert.equal(app.monthlyRequests.length, summaryRequests, 'loading more does not reload the dashboard');
  await app.loadMore();
  assert.equal(app.feedRequests.length, 3);
});

test('an exact page and an empty dataset do not offer unnecessary Load more', async () => {
  for (const count of [0, 50]) {
    const app = await boot({ rows: manyExpenses(count) });
    assert.equal(app.nodes['expense-list'].children.length, count);
    assert.equal(app.nodes['load-more-expenses'].hidden, true);
    assert.equal(app.feedRequests.length, 1);
  }
});

test('failed next page retains the feed and retries from the same offset', async () => {
  const app = await boot({ rows: manyExpenses(75) });
  app.setReadError(true);
  await app.loadMore();
  assert.equal(app.nodes['expense-list'].children.length, 50);
  assert.equal(app.nodes['load-more-expenses'].disabled, false);
  assert.match(app.nodes['feed-status'].textContent, /Use Load more to retry/);
  app.setReadError(false);
  const pending = app.loadMore();
  await app.loadMore();
  await pending;
  assert.equal(app.nodes['expense-list'].children.length, 75);
  assert.deepEqual(app.feedRequests.at(-1), { start: 50, end: 99 });
});

test('search applies to newly loaded pages and refresh resets the feed to 50', async () => {
  const app = await boot({ rows: manyExpenses(75) });
  app.filter('Expense 74');
  assert.equal(app.nodes['expense-list'].children.length, 0);
  assert.equal(app.nodes['load-more-expenses'].hidden, false);
  await app.loadMore();
  assert.equal(app.nodes['expense-list'].children.length, 1);
  assert.equal(app.nodes['expense-search'].value, 'Expense 74');
  await app.refresh();
  assert.equal(app.nodes['expense-list'].children.length, 0);
  assert.deepEqual(app.feedRequests.at(-1), { start: 0, end: 49 });
  assert.equal(app.nodes['load-more-expenses'].hidden, false);
});

test('deleting a loaded row adjusts the next offset so the following row is not skipped', async () => {
  const app = await boot({ rows: manyExpenses(75) });
  await app.remove();
  assert.equal(app.nodes['expense-list'].children.length, 49);
  await app.loadMore();
  assert.deepEqual(app.feedRequests.at(-1), { start: 49, end: 98 });
  assert.equal(app.nodes['expense-list'].children.length, 74);
  const notes = app.nodes['expense-list'].children.map(row => row.children[0].children[2].textContent);
  assert.ok(notes.includes('Expense 50'));
  assert.equal(new Set(notes).size, 74);
  assert.equal(app.nodes['monthly-total'].textContent, '₹74.00');
});

test('saving after loading more resets to the newest 50 expenses', async () => {
  const app = await boot({ rows: manyExpenses(75) });
  await app.loadMore();
  await app.save();
  assert.equal(app.nodes['expense-list'].children.length, 50);
  assert.deepEqual(app.feedRequests.at(-1), { start: 0, end: 49 });
  assert.equal(app.nodes['monthly-total'].textContent, '₹80.00');
});

test('dashboard failure leaves the feed usable and can be recovered by refresh', async () => {
  const app = await boot({ rows: manyExpenses(75) });
  app.setMonthlyError(true);
  await app.refresh();
  assert.equal(app.nodes['expense-list'].children.length, 50);
  assert.match(app.nodes['monthly-summary'].textContent, /Could not refresh/);
  assert.equal(app.nodes['monthly-total'].textContent, '₹75.00');
  app.setMonthlyError(false);
  await app.refresh();
  assert.doesNotMatch(app.nodes['monthly-summary'].textContent, /Could not refresh/);
});
