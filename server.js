// Split: mini Splitwise, local-only single-operator tool.
// Zero dependencies: only Node.js stdlib (node:http, node:fs, node:path, node:crypto).
// Run: node server.js   (env PORT overrides, default 11000)
// Data: ./data.json written atomically (tmp file + rename).

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number.parseInt(process.env.PORT || '11000', 10) || 11000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---------------------------------------------------------------------------
// Store: load / seed / atomic save
// ---------------------------------------------------------------------------

function seedData() {
  return {
    members: [
      { id: crypto.randomUUID(), name: 'Alice', emoji: '🦊' },
      { id: crypto.randomUUID(), name: 'Bob', emoji: '🐻' },
      { id: crypto.randomUUID(), name: 'Carla', emoji: '🐱' },
    ],
    expenses: [],
    settlements: [],
  };
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    // Be tolerant: ensure the three arrays exist.
    if (!Array.isArray(data.members)) data.members = [];
    if (!Array.isArray(data.expenses)) data.expenses = [];
    if (!Array.isArray(data.settlements)) data.settlements = [];
    return data;
  } catch (err) {
    if (err && err.code !== 'ENOENT') console.error('Could not parse data.json, reseeding:', err.message);
    const data = seedData();
    // Seed one friendly example expense so balances/settle-up are visible.
    const [a, b, c] = data.members;
    if (a && b && c) {
      const id = crypto.randomUUID();
      data.expenses.push({
        id,
        description: 'Welcome dinner 🍕',
        amount: 60,
        currency: 'CHF',
        date: todayISO(),
        paidBy: a.id,
        split: [
          { memberId: a.id, share: 20 },
          { memberId: b.id, share: 20 },
          { memberId: c.id, share: 20 },
        ],
        category: 'Food',
        createdAt: new Date().toISOString(),
      });
    }
    saveData(data);
    return data;
  }
}

// Atomic write: write to tmp file in the same directory, then rename.
function saveData(data) {
  const tmp = DATA_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

let db = loadData();

// ---------------------------------------------------------------------------
// Money helpers: compute everything in integer cents to avoid float drift.
// Amounts in the API / file are major units (e.g. 12.50 CHF).
// ---------------------------------------------------------------------------

const toCents = (n) => Math.round(Number(n) * 100);
const toMajor = (cents) => Math.round(cents) / 100;
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function memberById(id) {
  return db.members.find((m) => m.id === id);
}

// Returns { balances: {memberId: number(major)}, settleUp: [{from,to,amount}], totalSpent }
function computeSummary() {
  // Work in cents internally.
  const bal = {};
  for (const m of db.members) bal[m.id] = 0;

  let totalCents = 0;

  for (const e of db.expenses) {
    const total = toCents(e.amount);
    if (!Number.isFinite(total) || total <= 0) continue;
    totalCents += total;
    // Convert each share to cents; fix rounding drift onto the first entry.
    const shares = (e.split || []).map((s) => ({
      memberId: s.memberId,
      cents: toCents(s.share),
    }));
    const sumShares = shares.reduce((a, s) => a + s.cents, 0);
    const drift = total - sumShares;
    if (shares.length > 0 && drift !== 0) shares[0].cents += drift;

    if (bal[e.paidBy] === undefined) bal[e.paidBy] = 0;
    bal[e.paidBy] += total;
    for (const s of shares) {
      if (bal[s.memberId] === undefined) bal[s.memberId] = 0;
      bal[s.memberId] -= s.cents;
    }
  }

  for (const s of db.settlements) {
    const amt = toCents(s.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    // "from" pays "to": from's balance goes up (owes less), to's goes down.
    if (bal[s.from] === undefined) bal[s.from] = 0;
    if (bal[s.to] === undefined) bal[s.to] = 0;
    bal[s.from] += amt;
    bal[s.to] -= amt;
  }

  // Greedy min-cash-flow: repeatedly match largest debtor with largest creditor.
  const debtors = []; // {id, amount} amount owed, positive cents
  const creditors = []; // {id, amount} amount to receive, positive cents
  for (const [id, cents] of Object.entries(bal)) {
    const r = Math.round(cents);
    if (r < -0.5) debtors.push({ id, amount: -r });
    else if (r > 0.5) creditors.push({ id, amount: r });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const settleUp = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amt = Math.min(d.amount, c.amount);
    if (amt > 0) settleUp.push({ from: d.id, to: c.id, amount: toMajor(amt) });
    d.amount -= amt;
    c.amount -= amt;
    if (d.amount <= 0.5) i++;
    if (c.amount <= 0.5) j++;
  }

  const balances = {};
  for (const [id, cents] of Object.entries(bal)) balances[id] = toMajor(cents);

  return { balances, settleUp, totalSpent: toMajor(totalCents) };
}

// ---------------------------------------------------------------------------
// Validation helpers (return an error string or null)
// ---------------------------------------------------------------------------

function validateExpensePayload(p, isPartial) {
  if (p.description !== undefined) {
    if (typeof p.description !== 'string' || p.description.trim() === '') return 'description must be a non-empty string';
    if (p.description.trim().length > 200) return 'description is too long (max 200 chars)';
  } else if (!isPartial) {
    return 'description is required';
  }
  if (p.amount !== undefined) {
    const a = Number(p.amount);
    if (!Number.isFinite(a) || a <= 0) return 'amount must be a number greater than 0';
    if (a > 100000000) return 'amount is unreasonably large';
  } else if (!isPartial) {
    return 'amount is required';
  }
  if (p.date !== undefined) {
    if (!isValidDate(p.date)) return 'date must be YYYY-MM-DD';
  } else if (!isPartial) {
    return 'date is required';
  }
  if (p.paidBy !== undefined) {
    if (typeof p.paidBy !== 'string' || !memberById(p.paidBy)) return 'paidBy must be a valid member id';
  } else if (!isPartial) {
    return 'paidBy is required';
  }
  if (p.split !== undefined) {
    if (!Array.isArray(p.split) || p.split.length === 0) return 'split must be a non-empty array';
    let sum = 0;
    const seen = new Set();
    for (const s of p.split) {
      if (!s || typeof s.memberId !== 'string' || !memberById(s.memberId)) return 'split[].memberId must be a valid member id';
      const sh = Number(s.share);
      if (!Number.isFinite(sh) || sh <= 0) return 'split[].share must be a number greater than 0';
      if (seen.has(s.memberId)) return 'split contains a duplicate member';
      seen.add(s.memberId);
      sum += sh;
    }
    const total = p.amount !== undefined ? Number(p.amount) : null;
    if (total !== null && !isPartial) {
      if (Math.abs(sum - total) > 0.011) return `split shares sum to ${round2(sum)} but total is ${round2(total)}`;
    }
    // For PATCH where amount may be unchanged, the route merges first then
    // calls this again on the merged object, so the check above still holds.
  } else if (!isPartial) {
    return 'split is required';
  }
  if (p.category !== undefined && p.category !== null && p.category !== '') {
    if (typeof p.category !== 'string' || p.category.length > 60) return 'category must be a short string';
  }
  if (p.currency !== undefined && p.currency !== 'CHF') return 'currency must be "CHF"';
  return null;
}

function validateSettlementPayload(p) {
  if (typeof p.from !== 'string' || !memberById(p.from)) return 'from must be a valid member id';
  if (typeof p.to !== 'string' || !memberById(p.to)) return 'to must be a valid member id';
  if (p.from === p.to) return 'from and to must be different members';
  const a = Number(p.amount);
  if (!Number.isFinite(a) || a <= 0) return 'amount must be a number greater than 0';
  if (!isValidDate(p.date)) return 'date must be YYYY-MM-DD';
  if (p.note !== undefined && p.note !== null && p.note !== '') {
    if (typeof p.note !== 'string' || p.note.length > 200) return 'note must be a short string';
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  // Map "/" -> "/index.html". Block path traversal.
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = decodeURIComponent(rel);
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback: unknown non-API GET routes serve index.html.
      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
          if (e2) return sendError(res, 404, 'Not found');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(d2);
        });
        return;
      }
      return sendError(res, 404, 'Not found');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method.toUpperCase();

  console.log(`${new Date().toISOString()} ${method} ${pathname}`);

  // --- Static frontend -----------------------------------------------------
  if (method === 'GET' && (pathname === '/' || !pathname.startsWith('/api/'))) {
    return serveStatic(req, res, pathname);
  }

  // --- GET /api/state ------------------------------------------------------
  if (method === 'GET' && pathname === '/api/state') {
    return sendJSON(res, 200, { members: db.members, expenses: db.expenses, settlements: db.settlements });
  }

  // --- GET /api/summary ----------------------------------------------------
  if (method === 'GET' && pathname === '/api/summary') {
    return sendJSON(res, 200, computeSummary());
  }

  // --- Members -------------------------------------------------------------
  if (pathname === '/api/members' && method === 'GET') {
    return sendJSON(res, 200, db.members);
  }
  if (pathname === '/api/members' && method === 'POST') {
    const body = await readJSONBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return sendError(res, 400, 'name is required');
    if (name.length > 60) return sendError(res, 400, 'name is too long (max 60 chars)');
    const emoji = typeof body.emoji === 'string' ? body.emoji.trim().slice(0, 8) : '';
    const member = { id: crypto.randomUUID(), name, ...(emoji ? { emoji } : {}) };
    db.members.push(member);
    saveData(db);
    return sendJSON(res, 201, member);
  }
  {
    const m = pathname.match(/^\/api\/members\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const member = memberById(id);
      if (!member) return sendError(res, 404, 'Member not found');
      if (method === 'PATCH') {
        const body = await readJSONBody(req);
        if (body.name !== undefined) {
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (!name) return sendError(res, 400, 'name must be a non-empty string');
          if (name.length > 60) return sendError(res, 400, 'name is too long (max 60 chars)');
          member.name = name;
        }
        if (body.emoji !== undefined) {
          member.emoji = typeof body.emoji === 'string' ? body.emoji.trim().slice(0, 8) : '';
          if (!member.emoji) delete member.emoji;
        }
        saveData(db);
        return sendJSON(res, 200, member);
      }
      if (method === 'DELETE') {
        const usedExpense = db.expenses.some((e) => e.paidBy === id || (e.split || []).some((s) => s.memberId === id));
        const usedSettlement = db.settlements.some((s) => s.from === id || s.to === id);
        if (usedExpense || usedSettlement) {
          return sendError(res, 409, 'Cannot delete: member is referenced by expenses or settlements. Delete those first.');
        }
        db.members = db.members.filter((x) => x.id !== id);
        saveData(db);
        return sendJSON(res, 200, { ok: true });
      }
      return sendError(res, 405, 'Method not allowed');
    }
  }

  // --- Expenses ------------------------------------------------------------
  if (pathname === '/api/expenses' && method === 'GET') {
    const sorted = [...db.expenses].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    );
    return sendJSON(res, 200, sorted);
  }
  if (pathname === '/api/expenses' && method === 'POST') {
    const body = await readJSONBody(req);
    const err = validateExpensePayload(body, false);
    if (err) return sendError(res, 400, err);
    const expense = {
      id: crypto.randomUUID(),
      description: body.description.trim(),
      amount: round2(Number(body.amount)),
      currency: 'CHF',
      date: body.date,
      paidBy: body.paidBy,
      split: body.split.map((s) => ({ memberId: s.memberId, share: round2(Number(s.share)) })),
      category: typeof body.category === 'string' && body.category.trim() ? body.category.trim().slice(0, 60) : undefined,
      createdAt: new Date().toISOString(),
    };
    if (!expense.category) delete expense.category;
    db.expenses.push(expense);
    saveData(db);
    return sendJSON(res, 201, expense);
  }
  {
    const m = pathname.match(/^\/api\/expenses\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const expense = db.expenses.find((e) => e.id === id);
      if (!expense) return sendError(res, 404, 'Expense not found');
      if (method === 'PATCH') {
        const body = await readJSONBody(req);
        const merged = {
          description: body.description !== undefined ? body.description : expense.description,
          amount: body.amount !== undefined ? body.amount : expense.amount,
          date: body.date !== undefined ? body.date : expense.date,
          paidBy: body.paidBy !== undefined ? body.paidBy : expense.paidBy,
          split: body.split !== undefined ? body.split : expense.split,
          category: body.category !== undefined ? body.category : expense.category,
          currency: 'CHF',
        };
        const err = validateExpensePayload(merged, false);
        if (err) return sendError(res, 400, err);
        expense.description = merged.description.trim();
        expense.amount = round2(Number(merged.amount));
        expense.currency = 'CHF';
        expense.date = merged.date;
        expense.paidBy = merged.paidBy;
        expense.split = merged.split.map((s) => ({ memberId: s.memberId, share: round2(Number(s.share)) }));
        if (typeof merged.category === 'string' && merged.category.trim()) {
          expense.category = merged.category.trim().slice(0, 60);
        } else {
          delete expense.category;
        }
        saveData(db);
        return sendJSON(res, 200, expense);
      }
      if (method === 'DELETE') {
        db.expenses = db.expenses.filter((e) => e.id !== id);
        saveData(db);
        return sendJSON(res, 200, { ok: true });
      }
      return sendError(res, 405, 'Method not allowed');
    }
  }

  // --- Settlements ---------------------------------------------------------
  if (pathname === '/api/settlements' && method === 'GET') {
    const sorted = [...db.settlements].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    );
    return sendJSON(res, 200, sorted);
  }
  if (pathname === '/api/settlements' && method === 'POST') {
    const body = await readJSONBody(req);
    if (body.date === undefined) body.date = todayISO();
    const err = validateSettlementPayload(body);
    if (err) return sendError(res, 400, err);
    const st = {
      id: crypto.randomUUID(),
      from: body.from,
      to: body.to,
      amount: round2(Number(body.amount)),
      date: body.date,
      createdAt: new Date().toISOString(),
    };
    if (typeof body.note === 'string' && body.note.trim()) st.note = body.note.trim().slice(0, 200);
    db.settlements.push(st);
    saveData(db);
    return sendJSON(res, 201, st);
  }
  {
    const m = pathname.match(/^\/api\/settlements\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const st = db.settlements.find((s) => s.id === id);
      if (!st) return sendError(res, 404, 'Settlement not found');
      if (method === 'DELETE') {
        db.settlements = db.settlements.filter((s) => s.id !== id);
        saveData(db);
        return sendJSON(res, 200, { ok: true });
      }
      return sendError(res, 405, 'Method not allowed');
    }
  }

  return sendError(res, 404, 'Not found');
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('Request failed:', err);
    if (!res.headersSent) sendError(res, err.status || 500, err.message || 'Internal server error');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Split is running at http://${HOST}:${PORT}  (data: ${DATA_FILE})`);
});
