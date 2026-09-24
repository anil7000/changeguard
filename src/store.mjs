import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();

export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS changes(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, idem TEXT NOT NULL,
        request_hash TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(tenant,idem));
      CREATE TABLE IF NOT EXISTS documents(id TEXT NOT NULL, tenant TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(tenant,id));
      CREATE TABLE IF NOT EXISTS targets(tenant TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_version VALUES(1);`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  change(tenant, id) { const r = this.db.prepare('SELECT body FROM changes WHERE tenant=? AND id=?').get(tenant, id); return r ? JSON.parse(r.body) : null; }
  list(tenant) { return this.db.prepare('SELECT body FROM changes WHERE tenant=? ORDER BY rowid DESC LIMIT 200').all(tenant).map(r => JSON.parse(r.body)); }
  all() { return this.db.prepare('SELECT body FROM changes').all().map(r => JSON.parse(r.body)); }
  byKey(tenant, key) { return this.db.prepare('SELECT id,request_hash FROM changes WHERE tenant=? AND idem=?').get(tenant, key); }
  insert(c, key, requestHash) { this.db.prepare('INSERT INTO changes VALUES(?,?,?,?,?)').run(c.id, c.tenant, key, requestHash, JSON.stringify(c)); }
  save(c) { c.updatedAt = now(); this.db.prepare('UPDATE changes SET body=? WHERE tenant=? AND id=?').run(JSON.stringify(c), c.tenant, c.id); }
  docs(tenant) { return this.db.prepare('SELECT body FROM documents WHERE tenant=?').all(tenant).map(r => JSON.parse(r.body)); }
  doc(tenant, id) { return this.docs(tenant).find(d => d.id === id); }
  putDoc(tenant, d) { this.db.prepare('INSERT INTO documents VALUES(?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET body=excluded.body').run(d.id, tenant, JSON.stringify(d)); }
  deleteDoc(tenant, id) { this.db.prepare('DELETE FROM documents WHERE tenant=? AND id=?').run(tenant, id); }
  target(tenant) { const r = this.db.prepare('SELECT body FROM targets WHERE tenant=?').get(tenant); return r ? JSON.parse(r.body) : null; }
  putTarget(tenant, target) { this.db.prepare('INSERT INTO targets VALUES(?,?) ON CONFLICT(tenant) DO UPDATE SET body=excluded.body').run(tenant, JSON.stringify(target)); }
  audit(tenant, actor, event, details = {}) {
    const previous = this.db.prepare('SELECT hash FROM audit WHERE tenant=? ORDER BY seq DESC LIMIT 1').get(tenant)?.hash ?? 'genesis';
    const body = { at: now(), actor, event, details, previous };
    const hash = digest(body);
    this.db.prepare('INSERT INTO audit(tenant,body,hash) VALUES(?,?,?)').run(tenant, JSON.stringify(body), hash);
  }
  events(tenant) { return this.db.prepare('SELECT seq,body,hash FROM audit WHERE tenant=? ORDER BY seq').all(tenant).map(r => ({ seq: r.seq, ...JSON.parse(r.body), hash: r.hash })); }
  close() { this.db.close(); }
}
