(() => {
  'use strict';

  const SUPABASE_URL = 'https://swvimqzgxhrshkfvawxd.supabase.co';
  // Public browser key from Supabase Project Settings > API Keys.
  // Never use a database password, service_role key, or sb_secret_ key here.
  const SUPABASE_PUBLIC_KEY = 'sb_publishable_AhGRTOKcwbA7wIdSa4ehZQ_H4HQMfAQ';

  const byId = (id) => document.getElementById(id);
  const form = byId('expense-form');
  const dateInput = byId('expense-date');
  const amountInput = byId('expense-amount');
  const categoryInput = byId('expense-category');
  const paymentMethodInput = byId('expense-payment-method');
  const PAYMENT_METHODS = ['UPI', 'Cash', 'Credit Card', 'Net Banking'];
  const noteInput = byId('expense-note');
  const submit = byId('submit-expense');
  const refresh = byId('refresh-expenses');
  const loadMore = byId('load-more-expenses');
  const PAGE_SIZE = 50;
  const formStatus = byId('form-status');
  const feedStatus = byId('feed-status');
  const list = byId('expense-list');
  const emptyState = byId('feed-empty-state');
  const setupStatus = byId('setup-status');
  const search = byId('expense-search');
  const monthlyTotal = byId('monthly-total');
  const monthlySummary = byId('monthly-summary');
  const monthlyPeriod = byId('monthly-period');
  const chartCanvas = byId('category-chart');
  const chartEmpty = byId('chart-empty-state');
  const breakdown = byId('category-breakdown');
  const activeUser = byId('active-user');
  const userStatus = byId('user-status');
  const actionStatus = byId('expense-action-status');
  const openTotals = byId('open-totals');
  const totalsDialog = byId('totals-dialog');
  const totalsForm = byId('totals-form');
  const totalsUser = byId('totals-user');
  const totalsFrom = byId('totals-from');
  const totalsTo = byId('totals-to');
  const totalsAmount = byId('totals-amount');
  const totalsPeriod = byId('totals-period');
  const totalsStatus = byId('totals-status');
  const totalsResult = byId('totals-result');
  const totalsExpenses = byId('totals-expenses');
  const totalsExpenseList = byId('totals-expense-list');
  let totalsRequest = 0;
  const USER_STORAGE_KEY = 'expense-tracker.active-user';
  let users = [];
  let usersReady = false;
  let selectedUser = '';
  let deletingId = null;
  let deleteButtons = [];
  const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
  const dateFormat = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  let client;
  let expenses = [];
  let monthlyExpenses = [];
  let dashboardMonth = '';
  let monthlyRequest = 0;
  let nextOffset = 0;
  let totalExpenses = null;
  let hasMore = false;
  let saving = false;
  let loading = false;
  let hasLoaded = false;
  let lastLoadError = '';
  let categoryChart;
  const draftList = byId('draft-list');
  const pendingDialog = byId('pending-expenses');
  const openPending = byId('open-pending');
  const pendingCount = byId('pending-count');
  const draftStatus = byId('draft-status');
  const refreshDrafts = byId('refresh-drafts');
  const draftReview = byId('draft-review');
  const draftReviewInfo = byId('draft-review-info');
  const cancelDraftReview = byId('cancel-draft-review');
  const upiMessageForm = byId('upi-message-form');
  const upiMessage = byId('upi-message');
  const prepareDraft = byId('prepare-upi-draft');
  const upiMessageStatus = byId('upi-message-status');
  let drafts = [];
  let reviewingDraft = null;
  let draftRequest = 0;
  let draftsLoading = false;
  let draftMutation = false;
  let draftButtons = [];

  function today() {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')].join('-');
  }

  function message(target, text, isError = false) {
    target.textContent = text;
    target.classList.toggle('text-red-700', isError);
  }

  function errorMessage(error) {
    if (['42703', 'PGRST204', 'PGRST200', 'PGRST201'].includes(error?.code)) return 'Ensure supabase/03_users_table.sql and supabase/05_payment_method.sql have been applied after the earlier schema migrations in the Supabase SQL Editor, then refresh.';
    if (error?.code === '42501') return 'Access denied. Check the grants and RLS policies, including supabase/02_users_and_delete.sql.';
    if (error?.code === 'PGRST205' || error?.code === '42P01') return 'A required table was not found. Run the SQL migrations through supabase/03_users_table.sql in order.';
    if (error?.code === '23503') return 'The selected user no longer exists. Refresh the user list and choose a name again.';
    return 'Check your internet connection, Supabase project URL, public API key, and table setup.';
  }

  function syncControls() {
    openTotals.disabled = !client || !usersReady || saving || loading || deletingId !== null;
    submit.disabled = !client || !usersReady || !selectedUser || saving || loading || deletingId !== null;
    refresh.disabled = !client || saving || loading || deletingId !== null;
    loadMore.hidden = !hasLoaded || !hasMore;
    loadMore.disabled = !client || saving || loading || deletingId !== null;
    loadMore.textContent = loading ? 'Loading…' : 'Load more';
    activeUser.disabled = !usersReady || !users.length || saving || loading || deletingId !== null;
    activeUser.disabled ||= Boolean(reviewingDraft) || draftMutation;
    refreshDrafts.disabled = !client || !selectedUser || draftsLoading || draftMutation || saving;
    openPending.disabled = !client || !usersReady || !selectedUser || saving || draftMutation;
    prepareDraft.disabled = !client || !selectedUser || draftMutation || saving;
    upiMessage.disabled = draftMutation;
    cancelDraftReview.disabled = saving || draftMutation;
    for (const button of draftButtons) button.disabled = saving || loading || draftMutation || deletingId !== null;
    submit.disabled ||= draftMutation;
    for (const button of deleteButtons) button.disabled = !client || saving || loading || deletingId !== null;
    search.disabled = !hasLoaded;
    [dateInput, amountInput, categoryInput, paymentMethodInput, noteInput].forEach((input) => {
      input.disabled = saving;
    });
    submit.textContent = saving ? 'Saving…' : 'Save expense';
    form.setAttribute('aria-busy', String(saving));
    list.setAttribute('aria-busy', String(loading));
  }

  function draftError(error) {
    if (['PGRST205', '42P01', 'PGRST202', '42883'].includes(error?.code)) {
      return 'Apply supabase/07_upi_drafts.sql in the Supabase SQL Editor, then refresh pending payments.';
    }
    if (/^PT(404|409|422)$/.test(error?.code)) return error.message;
    return errorMessage(error);
  }

  function renderDrafts() {
    const fragment = document.createDocumentFragment();
    draftButtons = [];
    const pending = drafts.filter(row => row.user_id === selectedUser);
    pendingCount.textContent = String(pending.length);
    openPending.setAttribute('aria-label', `Pending payments, ${pending.length} waiting for review`);
    for (const draft of pending) {
      const row = element('li', 'flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between');
      const details = element('div', 'min-w-0 flex-1');
      details.append(element('p', 'break-words text-sm font-semibold', draft.recipient));
      details.append(element('p', 'mt-1 text-xs text-slate-500', `${draft.date} · UPI · Ref ${draft.transaction_ref}`));
      if (draft.suggested_category) details.append(element('p', 'mt-1 text-xs text-emerald-700', `Suggested: ${draft.suggested_category}`));
      const actions = element('div', 'flex shrink-0 flex-wrap items-center gap-2');
      const review = element('button', 'rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50', 'Review');
      review.type = 'button';
      review.addEventListener('click', () => reviewUpiDraft(draft));
      review.setAttribute('aria-label', `Review ${money.format(Number(draft.amount))} payment to ${draft.recipient}`);
      const dismiss = element('button', 'rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50', 'Dismiss');
      dismiss.type = 'button';
      dismiss.addEventListener('click', () => dismissUpiDraft(draft));
      dismiss.setAttribute('aria-label', `Dismiss payment to ${draft.recipient}`);
      draftButtons.push(review, dismiss);
      actions.append(element('span', 'text-sm font-bold tabular-nums', money.format(Number(draft.amount))), review, dismiss);
      row.append(details, actions);
      fragment.append(row);
    }
    draftList.replaceChildren(fragment);
    syncControls();
  }

  async function loadDrafts() {
    const request = ++draftRequest;
    const userId = selectedUser;
    renderDrafts();
    if (!client || !usersReady || !userId) {
      draftsLoading = false;
      message(draftStatus, 'Choose your name to view pending payments.');
      syncControls();
      return;
    }
    draftsLoading = true;
    syncControls();
    message(draftStatus, 'Loading pending payments…');
    try {
      const rows = [];
      let offset = 0;
      while (true) {
        const { data, error } = await client.from('upi_drafts')
          .select('id,user_id,date,amount,recipient,transaction_ref,suggested_category,payment_method,note,created_at')
          .eq('status', 'pending').eq('user_id', userId)
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .range(offset, offset + 499);
        if (request !== draftRequest) return;
        if (error) throw error;
        if (!data.length) break;
        rows.push(...data);
        offset += data.length;
      }
      drafts = rows;
      renderDrafts();
      message(draftStatus, rows.length ? `${rows.length} payment${rows.length === 1 ? '' : 's'} waiting for review.` : 'No pending UPI payments.');
    } catch (error) {
      if (request !== draftRequest) return;
      message(draftStatus, `Could not refresh pending payments. ${draftError(error)} Any displayed payments are from the previous successful refresh.`, true);
    } finally {
      if (request === draftRequest) { draftsLoading = false; syncControls(); }
    }
  }

  function leaveDraftReview() {
    reviewingDraft = null;
    draftReview.hidden = true;
    form.reset();
    dateInput.value = today();
    message(formStatus, 'The payment remains pending. You can review it again later.');
    syncControls();
  }

  function reviewUpiDraft(draft) {
    if (saving || loading || draftMutation || deletingId !== null || draft.user_id !== selectedUser) return;
    if (reviewingDraft?.id === draft.id) return;
    if ((reviewingDraft || amountInput.value || categoryInput.value || paymentMethodInput.value || noteInput.value || dateInput.value !== today()) &&
        !window.confirm('Replace the current form entries with this UPI payment? Any pending payment remains available for review.')) return;
    reviewingDraft = draft;
    dateInput.value = draft.date;
    amountInput.value = String(draft.amount);
    categoryInput.value = draft.suggested_category || '';
    paymentMethodInput.value = 'UPI';
    noteInput.value = draft.note;
    draftReviewInfo.textContent = `Reviewing ${draft.recipient} · Ref ${draft.transaction_ref}. Saving as ${users.find(user => user.id === draft.user_id)?.name}.`;
    draftReview.hidden = false;
    message(formStatus, draft.suggested_category ? 'Review the suggested category and payment details, then save.' : 'Choose a category, review the payment details, then save.');
    if (pendingDialog.open) pendingDialog.close();
    syncControls();
    form.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    categoryInput.focus();
  }

  async function dismissUpiDraft(draft) {
    if (saving || loading || draftMutation || deletingId !== null) return;
    if (!window.confirm(`Dismiss the ${money.format(Number(draft.amount))} payment to ${draft.recipient}? It will not be added to expenses.`)) return;
    draftMutation = true;
    syncControls();
    try {
      const { data, error } = await client.rpc('dismiss_upi_draft', { p_draft_id: draft.id });
      if (error) throw error;
      if (!data?.success || data.draft_id !== draft.id) throw new Error('Unconfirmed dismissal');
      ++draftRequest;
      draftsLoading = false;
      drafts = drafts.filter(row => row.id !== draft.id);
      if (reviewingDraft?.id === draft.id) leaveDraftReview();
      renderDrafts();
      message(draftStatus, 'Payment dismissed. No expense was created.');
    } catch (error) {
      message(draftStatus, `Dismissal could not be confirmed. ${draftError(error)} Refresh pending payments before retrying.`, true);
    } finally { draftMutation = false; syncControls(); }
  }

  async function prepareUpiDraft(event) {
    event.preventDefault();
    if (!client || !selectedUser || draftMutation || saving || !upiMessageForm.reportValidity()) return;
    draftMutation = true;
    syncControls();
    message(upiMessageStatus, 'Preparing payment for review…');
    try {
      const { data, error } = await client.rpc('queue_sbi_upi_message', { p_user_id: selectedUser, p_message: upiMessage.value });
      if (error) throw error;
      if (!data?.success || !data.draft_id) throw new Error('Unconfirmed draft');
      upiMessage.value = '';
      message(upiMessageStatus, data.message);
      await loadDrafts();
    } catch (error) {
      message(upiMessageStatus, `Could not confirm a draft. ${draftError(error)} The message is preserved; retrying the same SMS will not create a second draft.`, true);
    } finally { draftMutation = false; syncControls(); }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function expenseUserName(expense) {
    return expense.user?.name || 'Not recorded';
  }

  async function loadUsers() {
    usersReady = false;
    syncControls();
    message(userStatus, 'Loading users…');
    try {
      const rows = [];
      let offset = 0;
      while (true) {
        const { data, error } = await client.from('users').select('id,name')
          .order('name', { ascending: true }).order('id', { ascending: true })
          .range(offset, offset + 499);
        if (error) throw error;
        if (!data.length) break;
        rows.push(...data);
        offset += data.length;
      }
      users = rows;
      const fragment = document.createDocumentFragment();
      const placeholder = element('option', '', users.length ? 'Choose your name' : 'No users available');
      placeholder.value = '';
      fragment.append(placeholder);
      for (const user of users) {
        const option = element('option', '', user.name);
        option.value = user.id;
        fragment.append(option);
      }
      activeUser.replaceChildren(fragment);
      // Upgrade the old saved name to an ID once, then remember IDs going forward.
      let remembered = selectedUser;
      if (!remembered) {
        try { remembered = window.localStorage.getItem(USER_STORAGE_KEY) || ''; }
        catch { /* Selection still works without browser storage. */ }
      }
      const person = users.find((user) => user.id === remembered)
        || users.find((user) => user.name === remembered);
      activeUser.value = person?.id || '';
      usersReady = true;
      switchUser();
      if (!users.length) message(userStatus, 'No users available. Add a user in Supabase’s users table, then use Refresh expenses.');
    } catch (error) {
      selectedUser = '';
      loadDrafts();
      const fragment = document.createDocumentFragment();
      const option = element('option', '', 'Users unavailable');
      option.value = '';
      fragment.append(option);
      activeUser.replaceChildren(fragment);
      message(userStatus, `Could not load users. ${errorMessage(error)} Use Refresh expenses to retry.`, true);
      throw error;
    } finally {
      syncControls();
    }
  }

  function renderExpenses() {
    const query = search.value.trim().toLocaleLowerCase('en-IN');
    const filtered = expenses.filter((expense) => {
      const [year, month, day] = expense.date.split('-').map(Number);
      const displayDate = dateFormat.format(new Date(year, month - 1, day));
      return [expense.category, expense.payment_method || 'Not recorded', expense.note || '', expense.date, displayDate, expenseUserName(expense)]
        .some((value) => value.toLocaleLowerCase('en-IN').includes(query));
    });
    const fragment = document.createDocumentFragment();
    deleteButtons = [];
    for (const expense of filtered) {
      const row = element('li', 'flex items-start justify-between gap-4 px-5 py-5 sm:px-6');
      const details = element('div', 'min-w-0');
      details.append(element('p', 'break-words text-sm font-semibold', expense.category));
      // Parse date-only values in local time so dates never shift across time zones.
      const [year, month, day] = expense.date.split('-').map(Number);
      const date = element('time', 'mt-1 block text-xs text-slate-500',
        dateFormat.format(new Date(year, month - 1, day)));
      date.dateTime = expense.date;
      details.append(date);
      if (expense.note) details.append(element('p',
        'mt-2 whitespace-pre-wrap break-words text-sm text-slate-600', expense.note));
      details.append(element('p', 'mt-2 text-xs text-slate-500', `Payment: ${expense.payment_method || 'Not recorded'}`));
      details.append(element('p', 'mt-2 text-xs font-medium text-emerald-700', `Added by: ${expenseUserName(expense)}`));
      const actions = element('div', 'flex shrink-0 flex-col items-end gap-2');
      const remove = element('button', 'rounded-lg px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50', deletingId === expense.id ? 'Deleting…' : 'Delete');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Delete ${expense.category} expense of ${money.format(Number(expense.amount))} on ${expense.date}, added by ${expenseUserName(expense)}`);
      remove.addEventListener('click', () => deleteExpense(expense));
      deleteButtons.push(remove);
      actions.append(element('p', 'text-sm font-bold tabular-nums', money.format(Number(expense.amount))), remove);
      row.append(details, actions);
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    emptyState.hidden = filtered.length > 0 || !hasLoaded;
    emptyState.querySelector('h3').textContent = query && expenses.length ? 'No matching expenses' : hasMore ? 'More expenses available' : 'No expenses yet';
    emptyState.querySelector('p').textContent = query && expenses.length
      ? 'Try another person, category, payment method, date, or note, or clear your search to see all expenses.'
      : hasMore ? 'Use Load more to see older expenses.' : 'Add your first expense using the form to start tracking your spending.';
    const loaded = totalExpenses === null ? `${expenses.length} expenses loaded` : `${expenses.length} of ${totalExpenses} expenses loaded`;
    const count = query ? `${filtered.length} matches in ${expenses.length} loaded expenses` : loaded;
    message(feedStatus, `${lastLoadError ? `${lastLoadError} ` : ''}${count} · latest date first`, Boolean(lastLoadError));
    syncControls();
  }

  function renderDashboard() {
    const now = new Date();
    const monthPrefix = today().slice(0, 7);
    const monthly = monthlyExpenses.filter((expense) => expense.date.startsWith(`${monthPrefix}-`));
    const groups = new Map();
    let totalCents = 0;
    for (const expense of monthly) {
      // Sum integer paise to avoid rounding errors such as 0.1 + 0.2.
      const cents = Math.round(Number(expense.amount) * 100);
      totalCents += cents;
      groups.set(expense.category, (groups.get(expense.category) || 0) + cents);
    }
    const categories = [...groups.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    monthlyTotal.textContent = money.format(totalCents / 100);
    monthlyTotal.setAttribute('aria-label', `Total spent this month: ${monthlyTotal.textContent}`);
    monthlyPeriod.textContent = `INR · ${new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(now)}`;
    monthlySummary.textContent = `${monthly.length} expense${monthly.length === 1 ? '' : 's'} across ${groups.size} categor${groups.size === 1 ? 'y' : 'ies'} this month.`;

    const colors = ['#047857', '#2563eb', '#d97706', '#9333ea', '#e11d48', '#0891b2', '#4f46e5', '#65a30d', '#64748b'];
    const fragment = document.createDocumentFragment();
    categories.forEach(([category, cents], index) => {
      const row = element('li', 'flex items-start justify-between gap-3 text-xs');
      const label = element('span', 'flex min-w-0 items-start gap-2');
      const swatch = element('span', 'mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full');
      swatch.style.backgroundColor = colors[index % colors.length];
      swatch.setAttribute('aria-hidden', 'true');
      label.append(swatch, element('span', 'break-words text-slate-600', category));
      row.append(label, element('span', 'shrink-0 font-medium tabular-nums',
        `${money.format(cents / 100)} · ${(cents / totalCents * 100).toFixed(1)}%`));
      fragment.append(row);
    });
    breakdown.replaceChildren(fragment);
    chartCanvas.setAttribute('aria-label', `Spending by category for ${monthlyPeriod.textContent}. Amounts and percentages are listed below.`);
    chartEmpty.hidden = categories.length > 0;
    chartCanvas.hidden = categories.length === 0;
    if (!categories.length) {
      categoryChart?.destroy();
      categoryChart = undefined;
      chartEmpty.querySelector('p').textContent = 'No expenses this month. Add one to see your breakdown.';
      return;
    }
    // Chart failure must not prevent saving, searching, or the text summary.
    try {
      if (!window.Chart) throw new Error('Chart.js unavailable');
      const data = {
        labels: categories.map(([category]) => category),
        datasets: [{
          data: categories.map(([, cents]) => cents / 100),
          backgroundColor: categories.map((_, index) => colors[index % colors.length]),
          borderWidth: 2,
          borderColor: '#ffffff',
        }],
      };
      if (categoryChart) {
        categoryChart.data = data;
        categoryChart.update();
      } else {
        categoryChart = new window.Chart(chartCanvas, {
          type: 'pie', data,
          options: {
            responsive: true, maintainAspectRatio: false,
            animation: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (context) => `${context.label}: ${money.format(context.parsed)}` } },
            },
          },
        });
      }
    } catch {
      categoryChart?.destroy();
      categoryChart = undefined;
      chartCanvas.hidden = true;
      chartEmpty.hidden = false;
      chartEmpty.querySelector('p').textContent = 'Chart unavailable. Category totals are listed below. Refresh to retry.';
    }
  }

  function resetTotalsDates() {
    totalsTo.value = today();
    totalsFrom.value = `${totalsTo.value.slice(0, 7)}-01`;
  }

  function renderTotalsExpenses(rows) {
    const fragment = document.createDocumentFragment();
    for (const expense of rows) {
      const row = element('li', 'flex items-start justify-between gap-4 py-4');
      const details = element('div', 'min-w-0');
      details.append(element('p', 'break-words text-sm font-semibold', expense.category));
      const [year, month, day] = expense.date.split('-').map(Number);
      const date = element('time', 'mt-1 block text-xs text-slate-500',
        dateFormat.format(new Date(year, month - 1, day)));
      date.dateTime = expense.date;
      details.append(date);
      if (expense.note) details.append(element('p',
        'mt-2 whitespace-pre-wrap break-words text-sm text-slate-600', expense.note));
      details.append(element('p', 'mt-2 text-xs text-slate-500', `Payment: ${expense.payment_method || 'Not recorded'}`));
      details.append(element('p', 'mt-2 break-words text-xs font-medium text-emerald-700', `Added by: ${expenseUserName(expense)}`));
      row.append(details, element('p', 'shrink-0 text-sm font-bold tabular-nums', money.format(Number(expense.amount))));
      fragment.append(row);
    }
    totalsExpenseList.replaceChildren(fragment);
    totalsExpenses.hidden = rows.length === 0;
  }

  async function loadTotals(event) {
    event?.preventDefault();
    const request = ++totalsRequest;
    totalsAmount.textContent = '—';
    totalsPeriod.textContent = '';
    renderTotalsExpenses([]);
    totalsResult.setAttribute('aria-busy', 'false');
    if (!client) return;
    if (!totalsForm.reportValidity()) {
      message(totalsStatus, 'Choose valid From and To dates.', true);
      return;
    }
    const from = totalsFrom.value;
    const to = totalsTo.value;
    if (!from || !to || from > to) {
      message(totalsStatus, 'Choose a From date on or before the To date.', true);
      totalsFrom.focus();
      return;
    }
    const userId = totalsUser.value;
    const person = users.find((user) => user.id === userId);
    if (userId && !person) {
      message(totalsStatus, 'This user is unavailable. Close the window and refresh expenses.', true);
      return;
    }
    const displayDate = (value) => {
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(0);
      date.setFullYear(year, month - 1, day);
      return dateFormat.format(date);
    };
    totalsPeriod.textContent = `${person?.name || 'Everyone'} · ${displayDate(from)} to ${displayDate(to)}`;
    message(totalsStatus, 'Loading total and expenses…');
    totalsResult.setAttribute('aria-busy', 'true');
    try {
      let offset = 0;
      let totalPaise = 0;
      const rows = [];
      while (true) {
        let query = client.from('expenses')
          .select('id,date,amount,category,payment_method,note,created_at,user_id,user:users!expenses_user_id_fkey(name)')
          .gte('date', from).lte('date', to);
        if (userId) query = query.eq('user_id', userId);
        const { data, error } = await query.order('date', { ascending: false })
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .range(offset, offset + 499);
        if (request !== totalsRequest) return;
        if (error) throw error;
        if (!data.length) break;
        rows.push(...data);
        for (const expense of data) totalPaise += Math.round(Number(expense.amount) * 100);
        offset += data.length;
      }
      totalsAmount.textContent = money.format(totalPaise / 100);
      renderTotalsExpenses(rows);
      message(totalsStatus, `${offset} expense${offset === 1 ? '' : 's'} in this date range.${offset ? '' : ' No expenses found.'}`);
    } catch (error) {
      if (request !== totalsRequest) return;
      message(totalsStatus, `Could not load total and expenses. ${errorMessage(error)} Select Show total to retry.`, true);
    } finally {
      if (request === totalsRequest) totalsResult.setAttribute('aria-busy', 'false');
    }
  }

  async function showTotals() {
    if (openTotals.disabled) return;
    const fragment = document.createDocumentFragment();
    const everyone = element('option', '', 'Everyone (including unattributed expenses)');
    everyone.value = '';
    fragment.append(everyone);
    for (const user of users) {
      const option = element('option', '', user.name);
      option.value = user.id;
      fragment.append(option);
    }
    totalsUser.replaceChildren(fragment);
    totalsUser.value = selectedUser;
    resetTotalsDates();
    totalsDialog.showModal();
    return loadTotals();
  }

  async function loadMonthlyExpenses() {
    const request = ++monthlyRequest;
    const month = today().slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    const nextMonth = `${monthNumber === 12 ? year + 1 : year}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, '0')}-01`;
    try {
      const rows = [];
      let offset = 0;
      while (true) {
        // Only the current month's minimal summary fields; never the full feed.
        const { data, error } = await client.from('expenses')
          .select('id,date,amount,category')
          .gte('date', `${month}-01`).lt('date', nextMonth)
          .order('id', { ascending: true }).range(offset, offset + 499);
        if (error) throw error;
        if (!data.length) break;
        rows.push(...data);
        offset += data.length;
      }
      if (request !== monthlyRequest) return;
      monthlyExpenses = rows;
      dashboardMonth = month;
      renderDashboard();
    } catch {
      if (request !== monthlyRequest) return;
      monthlySummary.textContent = 'Could not refresh the monthly summary. Use Refresh expenses to retry. Any displayed totals are from the previous successful load.';
    }
  }

  async function loadExpenses(append = false) {
    if (!client || loading || (append && (!hasLoaded || !hasMore))) return false;
    loading = true;
    emptyState.hidden = true;
    syncControls();
    message(feedStatus, 'Loading expenses…');
    try {
      if (!append) await loadUsers();
      const offset = append ? nextOffset : 0;
      const { data, error, count } = await client.from('expenses')
        .select('id,date,amount,category,payment_method,note,created_at,user_id,user:users!expenses_user_id_fkey(name)', { count: 'exact' })
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const combined = append ? [...expenses, ...data] : data;
      expenses = [...new Map(combined.map((expense) => [expense.id, expense])).values()];
      nextOffset = offset + data.length;
      totalExpenses = count ?? null;
      hasMore = data.length > 0 && (count === null || count === undefined ? data.length === PAGE_SIZE : nextOffset < count);
      hasLoaded = true;
      lastLoadError = '';
      renderExpenses();
      if (!append) await loadMonthlyExpenses();
      return true;
    } catch (error) {
      lastLoadError = `Could not load expenses. ${errorMessage(error)} ${append ? 'Use Load more to retry.' : 'Use Refresh expenses to retry.'}${hasLoaded ? ' Showing previously loaded data.' : ''}`;
      if (hasLoaded) renderExpenses();
      else message(feedStatus, lastLoadError, true);
      return false;
    } finally {
      loading = false;
      syncControls();
    }
  }

  async function saveExpense(event) {
    event.preventDefault();
    if (!client || saving || loading || draftMutation || deletingId !== null) return;
    if (!usersReady || !users.some((user) => user.id === selectedUser)) {
      message(formStatus, 'Choose your name at the top of the page before saving.', true);
      activeUser.focus();
      return;
    }
    if (!form.reportValidity()) return;
    if (!PAYMENT_METHODS.includes(paymentMethodInput.value)) {
      message(formStatus, 'Choose a payment method before saving.', true);
      paymentMethodInput.focus();
      return;
    }
    const payload = {
      date: dateInput.value,
      amount: amountInput.value,
      category: categoryInput.value.trim(),
      payment_method: paymentMethodInput.value,
      note: noteInput.value.trim(),
      user_id: selectedUser,
    };
    if (!payload.category || !Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) {
      message(formStatus, 'Choose a category and enter an amount greater than zero.', true);
      return;
    }
    const draft = reviewingDraft;
    if (draft && draft.user_id !== selectedUser) {
      message(formStatus, 'This draft belongs to another person. Leave review and select the correct name.', true);
      return;
    }
    saving = true;
    syncControls();
    message(formStatus, 'Saving expense…');
    let alreadySaved = false;
    try {
      if (draft) {
        const { data, error } = await client.rpc('save_upi_draft', { p_draft_id: draft.id,
          p_date: payload.date, p_amount: payload.amount, p_category: payload.category,
          p_payment_method: payload.payment_method, p_note: payload.note });
        if (error) throw error;
        if (data?.success !== true || !data.expense_id) throw new Error('Unconfirmed save');
        alreadySaved = data.duplicate === true;
        ++draftRequest;
        draftsLoading = false;
        drafts = drafts.filter(row => row.id !== draft.id);
        reviewingDraft = null;
        draftReview.hidden = true;
        renderDrafts();
      } else {
        const { error } = await client.from('expenses').insert(payload);
        if (error) throw error;
      }
    } catch (error) {
      message(formStatus, draft
        ? `Save could not be confirmed. ${draftError(error)} Your entries are preserved. Retrying this draft will not create a second expense.`
        : `Save could not be confirmed. ${errorMessage(error)} Your entries are preserved. Refresh the feed before retrying to avoid a duplicate.`, true);
      saving = false;
      syncControls();
      return;
    }

    form.reset();
    dateInput.value = today();
    message(formStatus, alreadySaved ? 'This payment was already saved. No duplicate expense was added.' : 'Expense saved.');
    // A refresh failure must not be reported as a failed insert.
    const refreshed = await loadExpenses();
    if (!refreshed) message(formStatus, 'Expense saved, but the feed could not refresh. Use Refresh expenses; do not submit it again.', true);
    saving = false;
    syncControls();
    amountInput.focus();
  }

  async function deleteExpense(expense) {
    if (!client || saving || loading || deletingId !== null) return;
    const confirmed = window.confirm(`Delete ${money.format(Number(expense.amount))} for ${expense.category} on ${expense.date}?\nAdded by: ${expenseUserName(expense)}.\nThis permanently removes the expense for everyone.`);
    if (!confirmed) return;
    deletingId = expense.id;
    actionStatus.hidden = false;
    message(actionStatus, 'Deleting expense…');
    renderExpenses();
    try {
      // Return deleted IDs so a policy-blocked, zero-row delete is not called a success.
      const { data, error } = await client.from('expenses').delete().eq('id', expense.id).select('id');
      if (error) throw error;
      if (!data?.some((row) => row.id === expense.id)) {
        message(actionStatus, 'No expense was deleted. It may have already been removed, or delete permission is missing. Refresh the feed and check supabase/02_users_and_delete.sql.', true);
        return;
      }
      expenses = expenses.filter((row) => row.id !== expense.id);
      // Removing a loaded row shifts the next server page back by one.
      nextOffset = Math.max(0, nextOffset - 1);
      if (totalExpenses !== null) totalExpenses = Math.max(0, totalExpenses - 1);
      if (totalExpenses !== null) hasMore = nextOffset < totalExpenses;
      ++monthlyRequest;
      monthlyExpenses = monthlyExpenses.filter((row) => row.id !== expense.id);
      renderExpenses();
      if (dashboardMonth === today().slice(0, 7)) renderDashboard();
      message(actionStatus, 'Expense deleted.');
    } catch (error) {
      message(actionStatus, `Delete could not be confirmed. ${errorMessage(error)} Refresh the feed before retrying.`, true);
    } finally {
      deletingId = null;
      renderExpenses();
    }
  }

  function switchUser() {
    const person = usersReady ? users.find((user) => user.id === activeUser.value) : undefined;
    selectedUser = person?.id || '';
    activeUser.value = selectedUser;
    let remembered = true;
    try {
      if (selectedUser) window.localStorage.setItem(USER_STORAGE_KEY, selectedUser);
      else window.localStorage.removeItem(USER_STORAGE_KEY);
    } catch { remembered = false; }
    message(userStatus, selectedUser
      ? `Adding new expenses as ${person.name}.${remembered ? '' : ' Browser storage is unavailable; choose your name again next visit.'}`
      : 'Choose your name to start adding expenses.');
    syncControls();
    loadDrafts();
  }

  openPending.addEventListener('click', () => {
    if (openPending.disabled) return;
    pendingDialog.showModal();
    return loadDrafts();
  });
  byId('close-pending').addEventListener('click', () => pendingDialog.close());
  pendingDialog.addEventListener('close', () => {
    if (reviewingDraft) categoryInput.focus();
    else openPending.focus();
  });
  refreshDrafts.addEventListener('click', loadDrafts);
  upiMessageForm.addEventListener('submit', prepareUpiDraft);
  cancelDraftReview.addEventListener('click', () => {
    if (!saving && !draftMutation) leaveDraftReview();
  });
  activeUser.addEventListener('change', switchUser);
  openTotals.addEventListener('click', showTotals);
  byId('close-totals').addEventListener('click', () => totalsDialog.close());
  totalsDialog.addEventListener('close', () => {
    ++totalsRequest;
    openTotals.focus();
  });
  totalsForm.addEventListener('submit', loadTotals);
  // Invalidate a pending result immediately when its filters change.
  for (const input of [totalsUser, totalsFrom, totalsTo]) {
    input.addEventListener('change', loadTotals);
  }
  byId('reset-totals').addEventListener('click', () => {
    resetTotalsDates();
    return loadTotals();
  });

  dateInput.value = today();
  form.addEventListener('submit', saveExpense);
  refresh.addEventListener('click', () => loadExpenses());
  loadMore.addEventListener('click', () => loadExpenses(true));
  search.addEventListener('input', renderExpenses);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && client && usersReady && !draftMutation && !saving) loadDrafts();
    if (!document.hidden && hasLoaded && !loading && dashboardMonth !== today().slice(0, 7)) loadMonthlyExpenses();
  });

  if (SUPABASE_PUBLIC_KEY === 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY') {
    message(setupStatus, 'Setup needed: add your Supabase publishable or anon key to SUPABASE_PUBLIC_KEY in app.js.');
    message(formStatus, 'Add the public API key in app.js to enable saving.');
    message(feedStatus, 'Waiting for Supabase configuration.');
    emptyState.hidden = true;
    return;
  }

  try {
    if (!window.supabase?.createClient) throw new Error('Supabase SDK unavailable');
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    message(setupStatus, 'Shared tracker: names identify who added an expense. User switching does not require a password.');
    message(formStatus, 'Fields marked * are required.');
    loadExpenses();
  } catch {
    client = undefined;
    message(setupStatus, 'Could not initialize Supabase. Check your public API key and reload; ensure the Supabase CDN script is accessible.', true);
    message(formStatus, 'Saving is unavailable until Supabase is configured.', true);
    message(feedStatus, 'Connection setup failed.', true);
    emptyState.hidden = true;
  }
  syncControls();
})();
