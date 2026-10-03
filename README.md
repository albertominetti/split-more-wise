# Split

A local-only group expense splitter (a mini Splitwise) built around a **single-operator**
model: one person uses the app and can record expenses **on behalf of anyone** in the group.

- The **payer can be any member**, not just the operator.
- **Participants can be any subset** of members.
- No login, no accounts, no multi-user auth. It is a single-operator tool.
- Zero npm dependencies: the backend uses only the Node.js standard library.
- The frontend is vanilla HTML, CSS and JavaScript. No frameworks, no CDN, no build step, fully offline.

## Table of contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [REST API](#rest-api)
- [Data model](#data-model)
- [Project structure](#project-structure)
- [Design notes](#design-notes)
- [License](#license)

## Overview

Split keeps track of who paid for what in a small group and computes who owes whom.
Because it is designed for a single operator, the person using the app can enter an
expense that was paid by a friend and shared among several people, which makes it a fast
way to keep a shared ledger without asking everyone to install anything.

All state lives in a single JSON file next to the server. Starting the server with no
data file seeds a small example group so the interface is immediately usable.

## Screenshots

All screenshots use the mobile layout, emulated on an iPhone 14 Pro (393 x 852 viewport,
3x device pixel ratio, mobile user agent and touch input).

Adding an expense, with the live split preview for each split mode:

| Equal | By shares | By exact amounts |
|---|---|---|
| ![Equal split](docs/screenshots/01-add-expense-equal.png) | ![Split by shares](docs/screenshots/02-split-shares.png) | ![Split by exact amounts](docs/screenshots/03-split-exact.png) |

Settle-up pre-fill and the expense list:

| Settle up | Expenses |
|---|---|
| ![Settle up](docs/screenshots/04-settle-up.png) | ![Expenses](docs/screenshots/05-expenses.png) |

## Features

1. **Members**: add, rename and delete members. A member cannot be deleted while it is
   referenced by an expense or a settlement (the API returns `409`). The member list
   shows each person's current balance.
2. **Add an expense**: description, amount (CHF), date (defaults to today), a payer
   dropdown with **any** member, participant checkboxes, and three split modes:
   - equal,
   - by shares,
   - by exact amounts.

   A live preview shows each person's share, and the split is validated so that the
   shares always sum to the total.
3. **Expense list**: newest first, with description, amount, payer, per-person shares and
   category, plus edit and delete.
4. **Balances**: net balance per member (positive means the person is owed money,
   negative means the person owes money), together with a **who owes whom** settle-up
   list computed with a greedy min-cash-flow algorithm (repeatedly matching the largest
   debtor with the largest creditor).
5. **Settlements (payments)**: record a direct repayment between two members, which
   adjusts the balances. Payments are listed newest first and can be deleted.
6. **Dashboard**: total spent, counts, per-member balances and settle-up suggestions with
   a one-click **Settle** pre-fill.
7. **Who am I** selector (optional): a pure display highlight stored in `localStorage`.
   It never restricts who can record what.

## Tech stack

- **Backend**: Node.js standard library only (`node:http`, `node:fs`, `node:path`,
  `node:crypto`). No web framework, no dependencies.
- **Frontend**: vanilla HTML, CSS and JavaScript. No framework, no bundler, no CDN.
- **Persistence**: a single JSON file, written atomically.

## Requirements

- Node.js 18 or newer (developed and tested on Node 24).
- Any modern browser.

## Getting started

```bash
node server.js
```

Then open <http://localhost:11000/>.

To run it in the background:

```bash
nohup node server.js > server.log 2>&1 &
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `11000` | TCP port the server listens on. |

The server binds to `0.0.0.0`, so it is reachable from the local network. Because there is
no authentication, only expose it on trusted networks. For a friendly hostname and TLS in
a home network, put it behind a reverse proxy.

## REST API

All endpoints speak JSON. Errors return a JSON body with an `error` field and an
appropriate HTTP status code.

| Method | Path | Description |
|---|---|---|
| `GET` / `POST` | `/api/members` | List members / create one (`{name, emoji?}`) |
| `PATCH` / `DELETE` | `/api/members/:id` | Rename / delete a member (`409` if referenced) |
| `GET` / `POST` | `/api/expenses` | List expenses (newest first) / create one |
| `PATCH` / `DELETE` | `/api/expenses/:id` | Update / delete an expense |
| `GET` / `POST` | `/api/settlements` | List settlements (newest first) / create one |
| `DELETE` | `/api/settlements/:id` | Delete a settlement |
| `GET` | `/api/summary` | `{ balances, settleUp, totalSpent }` |
| `GET` | `/api/state` | Full state: `{ members, expenses, settlements }` |
| `GET` | `/` | Static frontend served from `public/` |

## Data model

Expense:

```json
{
  "id": "uuid",
  "description": "Groceries",
  "amount": 42.5,
  "currency": "CHF",
  "date": "2026-10-03",
  "paidBy": "<memberId>",
  "split": [{ "memberId": "<memberId>", "share": 21.25 }],
  "category": "Food",
  "createdAt": "2026-10-03T12:00:00.000Z"
}
```

Settlement:

```json
{
  "id": "uuid",
  "from": "<memberId that pays>",
  "to": "<memberId that receives>",
  "amount": 20,
  "date": "2026-10-03",
  "note": "Twint",
  "createdAt": "2026-10-03T12:00:00.000Z"
}
```

Amounts are entered in major units (for example `12.50` CHF). All arithmetic is performed
in **integer cents** to avoid floating point drift; any rounding remainder is assigned to
the first participant and the behaviour is mirrored on both client and server.

## Project structure

```
.
├── server.js            # HTTP server, router, API and static file handling
├── public/
│   ├── index.html       # Single-page application shell
│   ├── app.js           # Frontend logic (vanilla JS)
│   └── styles.css       # Styling
├── data.json            # Persisted store (created and seeded on first run)
├── package.json
├── LICENSE
└── README.md
```

## Design notes

- **Atomic writes**: `data.json` is written to a temporary file and then renamed, so a
  crash mid-write cannot corrupt the store.
- **Integer cents**: money is never handled as a binary float during calculations.
- **Greedy settle-up**: the suggested payments minimise the number of transfers needed to
  square everyone up, without claiming to be the unique optimal solution.

## License

Released under the MIT License. See [LICENSE](LICENSE).
