const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Map([
  ['upi', 'UPI'], ['cash', 'Cash'], ['credit card', 'Credit Card'], ['net banking', 'Net Banking'],
]);
const CATEGORIES = ['Apparels', 'Donation', 'Entertainment', 'Food', 'Fuel', 'Grocery',
  'Grooming/Beauty Parlour', 'Home', 'Insurance', 'Medicine', 'Mitesh Activa',
  'Mobile Recharge', 'Other', 'PGVCL', 'School', 'Shine', 'Tution'];
const MAX_BODY = 16384;

function reply(status, body) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function invalid(message) { throw new Error(message); }

export function validateExpense(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a JSON object.');
  const allowed = new Set(['request_id', 'date', 'amount', 'category', 'payment_method', 'note']);
  if (Object.keys(value).some(key => !allowed.has(key))) invalid('Unexpected expense field.');
  if (typeof value.request_id !== 'string' ||
      !(UUID.test(value.request_id) || /^[0-9a-f]{64}$/i.test(value.request_id))) {
    invalid('request_id must be a UUID or a SHA-256 hexadecimal string.');
  }
  if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
      value.date < '0001-01-01' || !Number.isFinite(Date.parse(`${value.date}T00:00:00Z`)) ||
      new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date) {
    invalid('Enter a valid date using yyyy-MM-dd.');
  }
  // Match numeric(12,2) without silently rounding an incorrectly dictated amount.
  const amount = typeof value.amount === 'number' || typeof value.amount === 'string'
    ? String(value.amount).trim() : '';
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    invalid('Amount must be greater than zero, at most 9,999,999,999.99, with up to two decimal places.');
  }
  const category = typeof value.category === 'string'
    ? CATEGORIES.find(item => item.toLowerCase() === value.category.trim().toLowerCase()) : undefined;
  if (!category) invalid('Choose an existing expense category.');
  const payment = typeof value.payment_method === 'string'
    ? METHODS.get(value.payment_method.trim().toLowerCase()) : undefined;
  if (!payment) invalid('Payment method must be UPI, Cash, Credit Card, or Net Banking.');
  const note = value.note === undefined ? '' : value.note;
  if (typeof note !== 'string' || [...note].length > 2000) invalid('Note must be text with at most 2000 characters.');
  return { p_request_id: value.request_id.toLowerCase(), p_date: value.date,
    p_amount: Number(amount).toFixed(2), p_category: category, p_payment_method: payment, p_note: note };
}

async function readJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) invalid('Missing JSON body.');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_BODY) { await reader.cancel(); throw new RangeError(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createHandler({ supabaseUrl, serviceRoleKey, fetchImpl = fetch }) {
  return async function handle(request) {
    if (request.method !== 'POST') return reply(405, { success: false, message: 'Use POST to log an expense.' });
    const token = request.headers.get('X-Shortcut-Token') || '';
    if (!/^et_[0-9a-f]{64}$/.test(token)) return reply(401, { success: false, message: 'Invalid or revoked shortcut token.' });
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(415, { success: false, message: 'Send an application/json body.' });
    }
    let payload;
    try { payload = validateExpense(await readJson(request)); }
    catch (error) {
      return reply(error instanceof RangeError ? 413 : 400, { success: false,
        message: error instanceof RangeError ? 'Expense request is too large.'
          : error instanceof SyntaxError ? 'Invalid JSON body.' : error.message });
    }
    if (!supabaseUrl || !serviceRoleKey) return reply(503, { success: false, message: 'Expense service is not configured.' });
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/log_shortcut_expense`, {
        method: 'POST', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, p_token_hash: tokenHash }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 && result.code === 'PT401') {
          return reply(401, { success: false, message: 'Invalid or revoked shortcut token.' });
        }
        if (response.status === 409 && result.code === 'PT409') {
          return reply(409, { success: false, message: 'This request ID belongs to different expense details. Start a new expense.' });
        }
        throw new Error('Database request failed.');
      }
      if (result?.success !== true || typeof result.expense_id !== 'string' || !UUID.test(result.expense_id) ||
          typeof result.duplicate !== 'boolean') throw new Error('Unconfirmed save.');
      return reply(200, { ...result, message: result.duplicate
        ? 'This expense was already saved. No duplicate was added.' : 'Expense saved.' });
    } catch {
      // Never expose credentials or database errors, or claim a failed connection means no save.
      return reply(503, { success: false,
        message: 'Could not confirm the save. Retry the same request ID and details, or check ExpenseTracker before starting a new expense.' });
    }
  };
}
