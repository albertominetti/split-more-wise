/* Split frontend: vanilla JS, no frameworks, works fully offline (same-origin only).
   Single operator tool: the payer dropdown can be ANY member; participants any subset. */

'use strict';

// ---------------------------------------------------------------- state ---
let state = { members: [], expenses: [], settlements: [] };
let summary = { balances: {}, settleUp: [], totalSpent: 0 };
let editingExpenseId = null;
let meId = localStorage.getItem('split.meId') || '';
// Participant widget state, preserved across re-renders: { memberId: { on, val } }
let partState = {};

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => 'CHF ' + Number(n).toFixed(2);
const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const memberName = (id) => {
  const m = state.members.find((x) => x.id === id);
  return m ? (m.emoji ? m.emoji + ' ' + m.name : m.name) : '(removed)';
};

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
function showError(id, msg) {
  const el = $(id);
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = msg;
}

// --------------------------------------------------------------- API ------
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ')'));
  return data;
}

async function refresh() {
  const [st, sum] = await Promise.all([
    api('GET', '/api/state'),
    api('GET', '/api/summary'),
  ]);
  state = st;
  summary = sum;
  renderAll();
}

// ------------------------------------------------------------ rendering ---
function renderAll() {
  renderStats();
  renderSettleUp();
  renderBalances();
  renderMembers();
  renderSelects();
  renderParticipants();
  renderExpenses();
  renderSettlements();
  updatePreview();
}

function renderStats() {
  $('total-spent').textContent = fmt(summary.totalSpent || 0);
  $('stat-total').textContent = fmt(summary.totalSpent || 0);
  $('stat-expenses').textContent = String(state.expenses.length);
  $('stat-members').textContent = String(state.members.length);
  const wrap = $('stat-me-wrap');
  if (meId && state.members.some((m) => m.id === meId)) {
    wrap.hidden = false;
    const b = summary.balances[meId] || 0;
    const el = $('stat-me');
    el.textContent = (b > 0 ? '+' : '') + fmt(b).replace('CHF ', 'CHF ');
    el.style.color = b > 0.005 ? 'var(--good)' : b < -0.005 ? 'var(--bad)' : 'var(--muted)';
  } else {
    wrap.hidden = true;
  }
  // "Who am I" selector options
  const sel = $('me-select');
  const cur = sel.value || meId;
  sel.innerHTML = '<option value="">Who am I? (off)</option>' +
    state.members.map((m) => `<option value="${esc(m.id)}">${esc((m.emoji ? m.emoji + ' ' : '') + m.name)}</option>`).join('');
  sel.value = state.members.some((m) => m.id === meId) ? meId : '';
  if (cur !== sel.value && cur) { /* selection changed externally; ignore */ }
}

function renderSettleUp() {
  const ul = $('settleup-list');
  if (!summary.settleUp.length) {
    ul.innerHTML = '<li class="empty">Everyone is settled up. 🎉</li>';
    return;
  }
  ul.innerHTML = summary.settleUp.map((s) =>
    `<li><span>${esc(memberName(s.from))} → ${esc(memberName(s.to))}</span>
     <span><strong>${esc(fmt(s.amount))}</strong>
     <button class="btn small settle-btn" data-from="${esc(s.from)}" data-to="${esc(s.to)}" data-amount="${esc(String(s.amount))}">Settle</button></span></li>`,
  ).join('');
  ul.querySelectorAll('.settle-btn').forEach((b) => b.addEventListener('click', () => {
    $('settle-from').value = b.dataset.from;
    $('settle-to').value = b.dataset.to;
    $('settle-amount').value = Number(b.dataset.amount).toFixed(2);
    $('settle-date').value = todayISO();
    $('settle-note').value = '';
    $('settlement-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Payment pre-filled. Hit "Record payment".');
  }));
}

function balanceBadge(b) {
  const cls = b > 0.005 ? 'pos' : b < -0.005 ? 'neg' : 'zero';
  const txt = (b > 0 ? '+' : '') + fmt(b);
  return `<span class="badge ${cls}">${esc(txt)}</span>`;
}

function renderBalances() {
  const ul = $('balance-list');
  if (!state.members.length) {
    ul.innerHTML = '<li class="empty">No members yet. Add some below.</li>';
    return;
  }
  const sorted = [...state.members].sort((a, b) => (summary.balances[b.id] || 0) - (summary.balances[a.id] || 0));
  ul.innerHTML = sorted.map((m) => {
    const b = summary.balances[m.id] || 0;
    const sub = b > 0.005 ? 'is owed' : b < -0.005 ? 'owes' : 'settled';
    return `<li class="${m.id === meId ? 'me' : ''}"><span>${esc((m.emoji ? m.emoji + ' ' : '') + m.name)} <small style="color:var(--muted)">· ${sub}</small></span>${balanceBadge(b)}</li>`;
  }).join('');
}

// --- Emoji picker --------------------------------------------------------
const EMOJI_SET = ['🦊','🐻','🐱','🐶','🐺','🐸','🐯','🦁','🐮','🐷','🐭','🐹','🐰','🐨','🐼','🐵','🐔','🐧','🦉','🦄','🐳','🐢','🦋','🌸','🌈','🍕','🍔','🍣','☕','🍺','🎉','⚽','🚗','🏠','💼','🎧','📚','⭐','🔥','💸','🧾','🙋'];
const EMOJI_DEFAULT = '😀';

let emojiPop = null;
let emojiAnchor = null;
let emojiCb = null;

function closeEmojiPicker() {
  if (emojiPop) emojiPop.hidden = true;
  if (emojiAnchor) emojiAnchor.setAttribute('aria-expanded', 'false');
  emojiAnchor = null;
  emojiCb = null;
}

function openEmojiPicker(anchorBtn, onPick) {
  if (!emojiPop) {
    emojiPop = document.createElement('div');
    emojiPop.className = 'emoji-pop';
    emojiPop.setAttribute('role', 'listbox');
    emojiPop.setAttribute('aria-label', 'Choose an emoji');
    for (const e of EMOJI_SET) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = e;
      b.setAttribute('role', 'option');
      b.addEventListener('click', () => { const cb = emojiCb; closeEmojiPicker(); if (cb) cb(e); });
      emojiPop.appendChild(b);
    }
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'none';
    none.textContent = 'No emoji';
    none.addEventListener('click', () => { const cb = emojiCb; closeEmojiPicker(); if (cb) cb(''); });
    emojiPop.appendChild(none);
    anchorBtn.parentNode.appendChild(emojiPop);
    document.addEventListener('click', (ev) => {
      if (emojiPop && !emojiPop.hidden && !emojiPop.contains(ev.target) && !ev.target.closest('.emoji-btn')) closeEmojiPicker();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeEmojiPicker(); });
  }
  const host = anchorBtn.closest('.member-form') || anchorBtn.closest('li') || anchorBtn.parentNode;
  if (emojiPop.parentNode !== host) host.appendChild(emojiPop);
  emojiAnchor = anchorBtn;
  emojiCb = onPick;
  emojiPop.hidden = false;
  anchorBtn.setAttribute('aria-expanded', 'true');
}

function toggleEmojiPicker(anchorBtn, onPick) {
  if (emojiPop && !emojiPop.hidden && emojiAnchor === anchorBtn) { closeEmojiPicker(); return; }
  openEmojiPicker(anchorBtn, onPick);
}

function renderMembers() {
  const ul = $('member-list');
  ul.innerHTML = state.members.length ? '' : '<li class="empty">No members yet.</li>';
  for (const m of state.members) {
    const li = document.createElement('li');
    if (m.id === meId) li.classList.add('me');
    li.innerHTML = `<button type="button" class="emoji-btn row-emoji" title="Change emoji" aria-label="Change emoji for ${esc(m.name)}">${esc(m.emoji || '👤')}</button>
      <span class="mname">${esc(m.name)}</span>
      <button class="btn small" data-act="rename">Rename</button>
      <button class="btn small danger" data-act="delete">Delete</button>`;
    const emojiBtn = li.querySelector('.row-emoji');
    emojiBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleEmojiPicker(emojiBtn, async (emoji) => {
        try {
          await api('PATCH', '/api/members/' + encodeURIComponent(m.id), { name: m.name, emoji: (emoji || '').trim() });
          await refresh();
        } catch (e) { showError('member-error', e.message); }
      });
    });
    li.querySelector('[data-act="rename"]').addEventListener('click', async () => {
      const name = window.prompt('New name for ' + m.name + ':', m.name);
      if (name === null) return;
      toggleEmojiPicker(emojiBtn, async (emoji) => {
        try {
          await api('PATCH', '/api/members/' + encodeURIComponent(m.id), {
            name: name.trim(),
            emoji: (emoji || '').trim(),
          });
          await refresh();
          toast('Member updated');
        } catch (e) { showError('member-error', e.message); }
      });
    });
    li.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!window.confirm('Delete ' + m.name + '? (Only possible if unused in expenses/payments.)')) return;
      try {
        showError('member-error', null);
        await api('DELETE', '/api/members/' + encodeURIComponent(m.id));
        if (meId === m.id) { meId = ''; localStorage.removeItem('split.meId'); }
        delete partState[m.id];
        await refresh();
        toast('Member deleted');
      } catch (e) { showError('member-error', e.message); }
    });
    ul.appendChild(li);
  }
}

function fillSelect(sel, placeholder) {
  const prev = sel.value;
  sel.innerHTML = placeholder ? `<option value="">${esc(placeholder)}</option>` : '';
  for (const m of state.members) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = (m.emoji ? m.emoji + ' ' : '') + m.name;
    sel.appendChild(o);
  }
  if (state.members.some((m) => m.id === prev)) sel.value = prev;
}

function renderSelects() {
  fillSelect($('exp-payer'), 'Select payer');
  // Keep the payer chosen while editing / re-rendering when possible.
  fillSelect($('settle-from'), 'Who pays');
  fillSelect($('settle-to'), 'Who receives');
  if ($('settle-from').options.length > 1 && !$('settle-from').value) $('settle-from').selectedIndex = 0;
}

// --- Expense participants + live preview ---------------------------------
function splitMode() {
  const r = document.querySelector('input[name="splitMode"]:checked');
  return r ? r.value : 'equal';
}

function renderParticipants() {
  const box = $('exp-participants');
  // init defaults for new members
  for (const m of state.members) {
    if (!partState[m.id]) partState[m.id] = { on: true, val: '' };
  }
  // drop removed members
  for (const id of Object.keys(partState)) {
    if (!state.members.some((m) => m.id === id)) delete partState[id];
  }
  const mode = splitMode();
  box.innerHTML = '';
  if (!state.members.length) {
    box.innerHTML = '<div class="empty">Add members first, then split with them.</div>';
    return;
  }
  for (const m of state.members) {
    const st = partState[m.id];
    const row = document.createElement('div');
    row.className = 'part-row' + (st.on ? '' : ' off');
    const label = mode === 'equal' ? '' : mode === 'shares'
      ? `<input class="pval" type="number" min="0" step="1" value="${esc(st.val || '')}" placeholder="shares" aria-label="Shares for ${esc(m.name)}" ${st.on ? '' : 'disabled'} />`
      : `<input class="pval" type="number" min="0" step="0.01" value="${esc(st.val || '')}" placeholder="CHF" aria-label="Exact amount for ${esc(m.name)}" ${st.on ? '' : 'disabled'} />`;
    row.innerHTML = `<input type="checkbox" ${st.on ? 'checked' : ''} aria-label="Include ${esc(m.name)}" />
      <span class="pname">${esc((m.emoji ? m.emoji + ' ' : '') + m.name)}</span>${label}`;
    const [cb] = [row.querySelector('input[type="checkbox"]')];
    cb.addEventListener('change', () => { st.on = cb.checked; renderParticipants(); updatePreview(); });
    const pv = row.querySelector('.pval');
    if (pv) pv.addEventListener('input', () => { st.val = pv.value; updatePreview(); });
    box.appendChild(row);
  }
}

// Compute the per-person split in integer cents (mirrors the server).
function computePreview() {
  const total = Math.round(Number($('exp-amount').value) * 100);
  const mode = splitMode();
  const ids = state.members.filter((m) => partState[m.id] && partState[m.id].on).map((m) => m.id);
  if (!Number.isFinite(total) || total <= 0) return { error: 'Enter an amount greater than 0 to see the preview.' };
  if (!ids.length) return { error: 'Select at least one participant.' };
  let rows = [];
  if (mode === 'equal') {
    const base = Math.floor(total / ids.length);
    let assigned = base * ids.length;
    rows = ids.map((id) => ({ memberId: id, cents: base }));
    if (rows.length) rows[0].cents += total - assigned; // remainder to first
  } else if (mode === 'shares') {
    const shares = ids.map((id) => ({ id, s: Number(partState[id].val) }));
    if (shares.some((x) => !Number.isFinite(x.s) || x.s <= 0)) return { error: 'Enter a positive share for each selected participant.' };
    const tot = shares.reduce((a, x) => a + x.s, 0);
    let assigned = 0;
    rows = shares.map((x, idx) => {
      const cents = idx === 0 ? 0 : Math.round((total * x.s) / tot); // computed below for idx 0
      return { memberId: x.id, cents };
    });
    // Compute all but first with rounding, first gets remainder (avoids drift).
    for (let k = 1; k < rows.length; k++) assigned += rows[k].cents;
    rows[0].cents = total - assigned;
    if (rows.some((r) => r.cents <= 0)) return { error: 'Shares produce a zero share; adjust them.' };
  } else {
    const exact = ids.map((id) => ({ id, cents: Math.round(Number(partState[id].val) * 100) }));
    if (exact.some((x) => !Number.isFinite(x.cents) || x.cents <= 0)) return { error: 'Enter an exact CHF amount for each selected participant.' };
    const sum = exact.reduce((a, x) => a + x.cents, 0);
    rows = exact.map((x) => ({ memberId: x.id, cents: x.cents }));
    if (sum !== total) {
      return {
        rows,
        sumCents: sum,
        error: `Shares sum to ${fmt(sum / 100)} but total is ${fmt(total / 100)} (off by ${fmt((sum - total) / 100)}).`,
      };
    }
  }
  return { rows, sumCents: total };
}

function updatePreview() {
  const el = $('exp-preview');
  const r = computePreview();
  if (!r.rows) {
    el.className = 'preview';
    el.textContent = r.error;
    return;
  }
  const lines = r.rows.map((x) => `${memberName(x.memberId)}: ${fmt(x.cents / 100)}`).join(' · ');
  if (r.error) {
    el.className = 'preview bad';
    el.textContent = '⚠ ' + r.error + ': ' + lines;
  } else {
    el.className = 'preview ok';
    el.textContent = '✓ ' + lines;
  }
}

function buildSplitFromForm() {
  const p = computePreview();
  if (!p.rows || p.error) throw new Error(p.error || 'Invalid split.');
  return p.rows.map((r) => ({ memberId: r.memberId, share: Math.round(r.cents) / 100 }));
}

// --- Expense list ----------------------------------------------------------
function renderExpenses() {
  const ul = $('expense-list');
  $('expense-count').textContent = state.expenses.length ? `(${state.expenses.length})` : '';
  const sorted = [...state.expenses].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (!sorted.length) {
    ul.innerHTML = '<li class="empty">No expenses yet. Add the first one above. ✨</li>';
    return;
  }
  ul.innerHTML = '';
  for (const e of sorted) {
    const li = document.createElement('li');
    const shares = (e.split || []).map((s) => `<span>${esc(memberName(s.memberId))}: ${esc(fmt(s.share))}</span>`).join('');
    li.innerHTML = `
      <div class="exp-head"><strong>${esc(e.description)}</strong><span class="exp-amount">${esc(fmt(e.amount))}</span></div>
      <div class="exp-meta">paid by <strong>${esc(memberName(e.paidBy))}</strong> · ${esc(e.date)} ${e.category ? `<span class="cat">${esc(e.category)}</span>` : ''}</div>
      <div class="exp-shares">${shares}</div>
      <div class="exp-actions">
        <button class="btn small" data-act="edit">Edit</button>
        <button class="btn small danger" data-act="del">Delete</button>
      </div>`;
    li.querySelector('[data-act="del"]').addEventListener('click', async () => {
      if (!window.confirm('Delete "' + e.description + '"?')) return;
      try {
        await api('DELETE', '/api/expenses/' + encodeURIComponent(e.id));
        await refresh();
        toast('Expense deleted');
      } catch (err) { toast(err.message); }
    });
    li.querySelector('[data-act="edit"]').addEventListener('click', () => startEditExpense(e));
    ul.appendChild(li);
  }
}

function startEditExpense(e) {
  editingExpenseId = e.id;
  $('expense-form-title').textContent = 'Edit expense';
  $('exp-submit').textContent = 'Save changes';
  $('exp-cancel').hidden = false;
  $('exp-description').value = e.description;
  $('exp-amount').value = Number(e.amount).toFixed(2);
  $('exp-date').value = e.date;
  $('exp-payer').value = e.paidBy;
  $('exp-category').value = e.category || '';
  // Detect mode: if shares are all equal -> equal; else default to exact values.
  const shares = (e.split || []).map((s) => Number(s.share));
  const allEqual = shares.length > 0 && shares.every((s) => Math.abs(s - shares[0]) < 0.005);
  const hasNonInteger = shares.some((s) => Math.abs(s - Math.round(s)) > 0.005);
  const mode = allEqual ? 'equal' : 'exact';
  document.querySelector(`input[name="splitMode"][value="${mode}"]`).checked = true;
  void hasNonInteger;
  partState = {};
  for (const m of state.members) {
    const found = (e.split || []).find((s) => s.memberId === m.id);
    partState[m.id] = found
      ? { on: true, val: mode === 'exact' ? Number(found.share).toFixed(2) : mode === 'shares' ? '1' : '' }
      : { on: false, val: '' };
  }
  renderParticipants();
  updatePreview();
  $('expense-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetExpenseForm() {
  editingExpenseId = null;
  $('expense-form-title').textContent = 'Add expense';
  $('exp-submit').textContent = 'Add expense';
  $('exp-cancel').hidden = true;
  $('expense-form').reset();
  $('exp-date').value = todayISO();
  document.querySelector('input[name="splitMode"][value="equal"]').checked = true;
  partState = {};
  for (const m of state.members) partState[m.id] = { on: true, val: '' };
  showError('exp-error', null);
  renderParticipants();
  updatePreview();
}

// --- Settlements -----------------------------------------------------------
function renderSettlements() {
  const ul = $('settlement-list');
  const sorted = [...state.settlements].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (!sorted.length) {
    ul.innerHTML = '<li class="empty">No payments recorded yet.</li>';
    return;
  }
  ul.innerHTML = '';
  for (const s of sorted) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="exp-head"><strong>${esc(memberName(s.from))} → ${esc(memberName(s.to))}</strong><span class="exp-amount">${esc(fmt(s.amount))}</span></div>
      <div class="exp-meta">${esc(s.date)}${s.note ? ' · ' + esc(s.note) : ''}</div>
      <div class="exp-actions"><button class="btn small danger" data-act="del">Delete</button></div>`;
    li.querySelector('[data-act="del"]').addEventListener('click', async () => {
      if (!window.confirm('Delete this payment?')) return;
      try {
        await api('DELETE', '/api/settlements/' + encodeURIComponent(s.id));
        await refresh();
        toast('Payment deleted');
      } catch (e) { toast(e.message); }
    });
    ul.appendChild(li);
  }
}

// ----------------------------------------------------------------- events --
function bindEvents() {
  document.querySelectorAll('input[name="splitMode"]').forEach((r) =>
    r.addEventListener('change', () => { renderParticipants(); updatePreview(); }));
  $('exp-amount').addEventListener('input', updatePreview);

  $('exp-cancel').addEventListener('click', resetExpenseForm);

  $('expense-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showError('exp-error', null);
    try {
      const description = $('exp-description').value.trim();
      const amount = Number($('exp-amount').value);
      const date = $('exp-date').value;
      const paidBy = $('exp-payer').value;
      const category = $('exp-category').value;
      if (!description) throw new Error('Please enter a description.');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than 0.');
      if (!date) throw new Error('Please pick a date.');
      if (!paidBy) throw new Error('Please choose who paid.');
      const split = buildSplitFromForm();
      const payload = { description, amount: Math.round(amount * 100) / 100, date, paidBy, split };
      if (category) payload.category = category;
      if (editingExpenseId) {
        await api('PATCH', '/api/expenses/' + encodeURIComponent(editingExpenseId), payload);
        toast('Expense updated');
      } else {
        await api('POST', '/api/expenses', payload);
        toast('Expense added');
      }
      resetExpenseForm();
      await refresh();
    } catch (e) { showError('exp-error', e.message); }
  });

  $('settlement-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showError('settle-error', null);
    try {
      const from = $('settle-from').value;
      const to = $('settle-to').value;
      const amount = Number($('settle-amount').value);
      const date = $('settle-date').value;
      const note = $('settle-note').value.trim();
      if (!from || !to) throw new Error('Choose both members.');
      if (from === to) throw new Error('From and to must be different members.');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than 0.');
      if (!date) throw new Error('Please pick a date.');
      const payload = { from, to, amount: Math.round(amount * 100) / 100, date };
      if (note) payload.note = note;
      await api('POST', '/api/settlements', payload);
      $('settle-amount').value = '';
      $('settle-note').value = '';
      await refresh();
      toast('Payment recorded');
    } catch (e) { showError('settle-error', e.message); }
  });

  $('member-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showError('member-error', null);
    try {
      const name = $('member-name').value.trim();
      const emoji = $('member-emoji').value.trim();
      if (!name) throw new Error('Please enter a name.');
      await api('POST', '/api/members', { name, emoji });
      $('member-name').value = '';
      $('member-emoji').value = '';
      $('member-emoji-btn').textContent = EMOJI_DEFAULT;
      closeEmojiPicker();
      await refresh();
      toast('Member added');
    } catch (e) { showError('member-error', e.message); }
  });

  $('member-emoji-btn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleEmojiPicker($('member-emoji-btn'), (emoji) => {
      $('member-emoji').value = emoji;
      $('member-emoji-btn').textContent = emoji || EMOJI_DEFAULT;
    });
  });

  $('me-select').addEventListener('change', (ev) => {
    meId = ev.target.value || '';
    if (meId) localStorage.setItem('split.meId', meId);
    else localStorage.removeItem('split.meId');
    renderAll();
  });
}

// ------------------------------------------------------------------- boot --
document.addEventListener('DOMContentLoaded', async () => {
  $('exp-date').value = todayISO();
  $('settle-date').value = todayISO();
  bindEvents();
  try {
    await refresh();
  } catch (e) {
    toast('Could not reach the server: ' + e.message);
  }
  try {
    const cfg = await api('GET', '/api/config');
    if (cfg && cfg.demo) {
      $('demo-badge').hidden = false;
      const reset = $('demo-reset');
      reset.hidden = false;
      reset.addEventListener('click', async () => {
        try {
          await api('POST', '/api/demo/reset');
          await refresh();
          toast('Demo data reset');
        } catch (e) { toast('Reset failed: ' + e.message); }
      });
    }
  } catch (_) { /* /api/config is optional */ }
});
