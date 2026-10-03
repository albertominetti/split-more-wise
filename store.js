'use strict';
// Storage abstraction for Split More Wise.
// Zero dependencies: only the Node standard library (file adapter) and global fetch (KV adapter).
//
// Adapters
//  - file : default. Path = DATA_FILE, or DATA_DIR/data.json, or ./data.json. Atomic write
//           (write to a temp file, then rename). Good for a local run, Docker, or a host with a
//           persistent disk (Render Disk, Fly volume, VPS).
//  - kv   : Upstash-compatible Redis over HTTP REST. Enabled when UPSTASH_REDIS_REST_URL and
//           UPSTASH_REDIS_REST_TOKEN are set. Vercel KV and the Upstash integrations expose the
//           same REST API (KV_REST_API_URL / KV_REST_API_TOKEN are also accepted). The whole
//           state is stored as one JSON value under DATA_KEY. This makes the app work on
//           serverless platforms (Vercel, Netlify, Cloudflare) where there is no filesystem.
//
// The two async methods are the only contract: load() -> data|null, save(data) -> void.

const fs = require('node:fs');
const path = require('node:path');

function createStore(env = process.env) {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '').trim();
  if (url && token) {
    return createKvStore(url.replace(/\/+$/, ''), token, env.DATA_KEY || 'split-more-wise:state');
  }
  const file = env.DATA_FILE || path.join(env.DATA_DIR || __dirname, 'data.json');
  return createFileStore(file);
}

function createFileStore(file) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (_) { /* ignore */ }
  return {
    kind: 'file',
    where: file,
    async load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        if (err && err.code !== 'ENOENT') console.error('[store:file] cannot parse', file, '-', err.message);
        return null;
      }
    },
    async save(data) {
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, file);
    },
  };
}

function createKvStore(url, token, key) {
  async function cmd(args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error('KV ' + args[0] + ' failed: HTTP ' + res.status);
    const json = await res.json();
    if (json && json.error) throw new Error('KV ' + args[0] + ' error: ' + json.error);
    return json ? json.result : null;
  }
  return {
    kind: 'kv',
    where: url.replace(/\/\/[^@]+@/, '//'), // never expose the token
    async load() {
      const raw = await cmd(['GET', key]);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (_) { return null; }
    },
    async save(data) {
      await cmd(['SET', key, JSON.stringify(data)]);
    },
  };
}

module.exports = { createStore };
