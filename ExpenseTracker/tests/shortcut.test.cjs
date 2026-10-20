const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const load = () => import('../supabase/functions/log-expense/handler.mjs');
const token = 'et_' + 'a'.repeat(64);
const requestId = '11111111-1111-4111-8111-111111111111';
const expenseId = '22222222-2222-4222-8222-222222222222';
const valid = () => ({ request_id: requestId, date: '2026-10-20', amount: 250.50,
  category: 'Food', payment_method: 'UPI', note: 'Lunch' });
const req = (body = valid(), headers = {}, method = 'POST') => new Request('https://test/log-expense', {
  method, headers: { 'Content-Type': 'application/json', 'X-Shortcut-Token': token, ...headers },
  ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});
const handler = async (fetchImpl) => (await load()).createHandler({
  supabaseUrl: 'https://test.supabase.co/', serviceRoleKey: 'server-secret', fetchImpl,
});

test('validates calendar dates, money precision, supported fields, and voice casing', async () => {
  const { validateExpense } = await load();
  assert.equal(validateExpense({ ...valid(), category: ' food ', payment_method: 'cash' }).p_category, 'Food');
  assert.equal(validateExpense({ ...valid(), amount: '9999999999.99' }).p_amount, '9999999999.99');
  assert.equal(validateExpense({ ...valid(), date: '2024-02-29' }).p_date, '2024-02-29');
  assert.equal(validateExpense({ ...valid(), request_id: 'A'.repeat(64) }).p_request_id, 'a'.repeat(64));
  for (const changes of [
    { date: '2026-02-29' }, { date: '2026-04-31' }, { date: '2026-13-01' }, { date: '0000-01-01' },
    { amount: 0 }, { amount: -1 }, { amount: 1.001 }, { amount: '1e3' }, { amount: 'Infinity' },
    { amount: 10000000000 }, { category: 'Unknown' }, { payment_method: 'Cheque' },
    { request_id: 'invalid' }, { user_id: requestId }, { note: 'x'.repeat(2001) },
  ]) assert.throws(() => validateExpense({ ...valid(), ...changes }), JSON.stringify(changes));
  assert.throws(() => validateExpense([]));
});

test('hashes token and forwards only normalized values to the server-only RPC', async () => {
  let calls = 0;
  const save = await handler(async (url, options) => {
    calls++;
    assert.equal(url, 'https://test.supabase.co/rest/v1/rpc/log_shortcut_expense');
    assert.equal(options.headers.Authorization, 'Bearer server-secret');
    const data = JSON.parse(options.body);
    assert.equal(data.p_token_hash, createHash('sha256').update(token).digest('hex'));
    assert.equal(data.p_amount, '250.50');
    assert.equal(data.p_request_id, requestId);
    assert.equal(options.body.includes(token), false);
    return Response.json({ success: true, expense_id: expenseId, duplicate: false });
  });
  const response = await save(req());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message, 'Expense saved.');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls, 1);
});

test('rejects malformed, unauthorized, oversized and non-JSON requests before database access', async () => {
  const save = await handler(() => { assert.fail('Must not access database'); });
  for (const [request, status] of [
    [req(null, {}, 'GET'), 405], [req(valid(), { 'X-Shortcut-Token': '' }), 401],
    [req(valid(), { 'Content-Type': 'text/plain' }), 415], [req('{bad'), 400],
    [req({ ...valid(), amount: 0 }), 400], [req('x'.repeat(17000)), 413],
  ]) {
    const response = await save(request);
    assert.equal(response.status, status);
    assert.equal((await response.json()).success, false);
  }
});

test('invalid/revoked tokens and changed retry payload have clear errors', async () => {
  for (const [status, code] of [[401, 'PT401'], [409, 'PT409']]) {
    const save = await handler(async () => Response.json({ code, message: 'internal details' }, { status }));
    const response = await save(req());
    assert.equal(response.status, status);
    assert.equal((await response.json()).success, false);
  }
});

test('preserves duplicate receipt without claiming another insert', async () => {
  const save = await handler(async () => Response.json({ success: true, expense_id: expenseId, duplicate: true }));
  const result = await (await save(req())).json();
  assert.equal(result.duplicate, true);
  assert.match(result.message, /already saved/);
});

test('connection loss, invalid responses and database errors never claim success or leak details', async () => {
  for (const mock of [
    async () => { throw new Error('server-secret'); },
    async () => new Response('bad gateway', { status: 502 }),
    async () => Response.json({ success: true }),
    async () => Response.json({ success: true, expense_id: expenseId, duplicate: 'false' }),
    async () => Response.json({ message: 'server-secret' }, { status: 500 }),
    async () => Response.json({ code: 'bad-service-key' }, { status: 401 }),
  ]) {
    const response = await (await handler(mock))(req());
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.success, false);
    assert.match(result.message, /same request ID/);
    assert.equal(result.message.includes('server-secret'), false);
  }
});

test('missing server configuration fails closed', async () => {
  const save = (await load()).createHandler({});
  assert.equal((await save(req())).status, 503);
});
