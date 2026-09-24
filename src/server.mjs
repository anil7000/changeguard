import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Store, digest, now, uid } from './store.mjs';
import { Engine, fail } from './engine.mjs';
import { acquireLock } from './lock.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const secureHeaders = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store'
};
function json(res, status, value) { res.writeHead(status, { ...secureHeaders, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function checkConfig(config) {
  if (!Array.isArray(config.users) || config.users.length < 2) throw new Error('Configure at least two independent identities');
  const tokens = new Set(); const ids = new Set();
  for (const u of config.users) {
    if (typeof u.token !== 'string' || u.token.length < 32 || tokens.has(u.token) || !/^[a-zA-Z0-9_-]{1,60}$/.test(u.id) || !/^[a-zA-Z0-9_-]{1,60}$/.test(u.tenant) || ids.has(`${u.tenant}/${u.id}`) || !Array.isArray(u.roles) || !u.roles.length || !u.roles.every(r => ['viewer', 'operator', 'approver', 'admin'].includes(r))) throw new Error('Invalid or duplicate identity configuration');
    tokens.add(u.token); ids.add(`${u.tenant}/${u.id}`);
  }
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) fail(415, 'Content-Type must be application/json');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 100000) fail(413, 'Request body exceeds 100 KB'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Invalid JSON'); }
}
const role = (user, name) => { if (!user.roles.includes(name)) fail(403, `${name} role required`); };

export async function start({ config, dbPath, host = '127.0.0.1', port = 0, interval = 100 } = {}) {
  checkConfig(config);
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const unlock = acquireLock(resolve(dbPath) + '.lock');
  let store; let engine;
  try { store = new Store(dbPath); engine = new Engine(store, config); engine.seed(new Set(config.users.map(u => u.tenant))); }
  catch (error) { store?.close(); unlock(); throw error; }
  const hashes = config.users.map(u => ({ user: u, hash: createHash('sha256').update(u.token).digest() }));
  const buckets = new Map();
  function authenticate(req) {
    const token = /^Bearer (.{1,300})$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const hash = createHash('sha256').update(token).digest();
    const found = hashes.find(x => timingSafeEqual(x.hash, hash));
    const key = found ? `${found.user.tenant}:${found.user.id}` : `ip:${req.socket.remoteAddress}`;
    const time = Date.now(); const bucket = buckets.get(key);
    if (!bucket || time - bucket.start > 60000) buckets.set(key, { start: time, count: 1 });
    else if (++bucket.count > 240) fail(429, 'Rate limit reached; wait one minute');
    if (buckets.size > 5000) for (const [k, v] of buckets) if (time - v.start > 60000) buckets.delete(k);
    if (!found) fail(401, 'Valid bearer token required');
    return found.user;
  }
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/healthz') return json(res, 200, { status: 'ok', version: '0.1.0' });
      if (req.method === 'GET' && path === '/readyz') { store.db.prepare('SELECT 1').get(); return json(res, 200, { status: 'ready', adapter: 'synthetic-http-pool' }); }
      if (req.method === 'GET' && assets[path]) { const [name, type] = assets[path]; res.writeHead(200, { ...secureHeaders, 'content-type': `${type}; charset=utf-8` }); return res.end(readFileSync(resolve(publicDir, name))); }
      if (!path.startsWith('/api/')) fail(404, 'Not found');
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) fail(403, 'Cross-origin request rejected');
      const user = authenticate(req);
      if (req.method === 'GET' && path === '/api/me') return json(res, 200, { id: user.id, tenant: user.tenant, roles: user.roles, llmConfigured: Boolean(config.llm?.url) });
      if (req.method === 'GET' && path === '/api/changes') return json(res, 200, store.list(user.tenant));
      if (req.method === 'GET' && path === '/api/target') return json(res, 200, store.target(user.tenant));
      if (req.method === 'GET' && path === '/api/audit') return json(res, 200, store.events(user.tenant));
      if (req.method === 'GET' && path === '/api/documents') return json(res, 200, store.docs(user.tenant));
      if (req.method === 'POST' && path === '/api/changes') { role(user, 'operator'); return json(res, 201, engine.submit(user, await body(req), req.headers['idempotency-key'])); }
      if (req.method === 'POST' && path === '/api/documents') {
        role(user, 'admin'); const data = await body(req);
        if (!data || typeof data !== 'object' || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 180 || typeof data.text !== 'string' || data.text.length < 20 || data.text.length > 50000 || typeof data.source !== 'string' || !data.source.trim() || data.source.length > 300) fail(400, 'Valid title, source and 20-50000 character text required');
        if (!Number.isInteger(data.ttlHours) || data.ttlHours < 1 || data.ttlHours > 720) fail(400, 'TTL must be 1-720 hours');
        const id = data.id ?? uid(); if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) fail(400, 'Invalid document ID');
        if (!store.doc(user.tenant, id) && store.docs(user.tenant).length >= 100) fail(409, 'Document quota reached');
        const doc = { id, title: data.title, source: data.source, text: data.text, digest: digest(data.text), expiresAt: new Date(Date.now() + data.ttlHours * 3600000).toISOString() };
        store.transaction(() => { store.putDoc(user.tenant, doc); store.audit(user.tenant, user.id, 'document-ingested', { id, digest: doc.digest }); });
        return json(res, 201, doc);
      }
      const documentMatch = /^\/api\/documents\/([a-zA-Z0-9_-]+)$/.exec(path);
      if (req.method === 'DELETE' && documentMatch) {
        role(user, 'admin'); if (!store.doc(user.tenant, documentMatch[1])) fail(404, 'Document not found');
        store.transaction(() => { store.deleteDoc(user.tenant, documentMatch[1]); store.audit(user.tenant, user.id, 'document-deleted', { id: documentMatch[1] }); });
        return json(res, 200, { deleted: true });
      }
      const match = /^\/api\/changes\/([a-zA-Z0-9-]+)(?:\/(approve|execute|cancel))?$/.exec(path);
      if (match && req.method === 'GET' && !match[2]) return json(res, 200, engine.current(user, match[1]));
      if (match && req.method === 'POST' && match[2]) {
        role(user, match[2] === 'approve' ? 'approver' : 'operator');
        return json(res, 200, engine[match[2]](user, match[1]));
      }
      fail(404, 'Route not found');
    } catch (e) { if (!res.headersSent && !res.destroyed) json(res, e.status ?? 500, { error: e.status ? e.message : 'Internal error; action not confirmed' }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  const timer = setInterval(() => engine.tick().catch(() => {}), interval);
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { clearInterval(timer); await engine.stop(); store.close(); unlock(); throw error; }
  let closed = false;
  return { server, store, engine, url: `http://${host}:${server.address().port}`, async close() { if (closed) return; closed = true; clearInterval(timer); await new Promise(resolve => server.close(resolve)); await engine.stop(); store.close(); unlock(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const configPath = resolve(process.env.CG_CONFIG ?? 'data/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.llm && process.env.CG_LLM_API_KEY) config.llm.apiKey = process.env.CG_LLM_API_KEY;
    const app = await start({ config, dbPath: process.env.CG_DB ?? 'data/changeguard.sqlite', host: process.env.CG_HOST ?? '127.0.0.1', port: Number(process.env.CG_PORT ?? 4310) });
    console.log(`ChangeGuard ready at ${app.url}; execution adapter: synthetic-http-pool`);
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
  } catch (e) { console.error(`Startup failed: ${e.message}. Run node tools/init.mjs first.`); process.exitCode = 1; }
}
