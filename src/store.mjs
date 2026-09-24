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
    this.db.exec(`CREATE INDEX IF NOT EXISTS changes_state ON changes(json_extract(body,'$.state'),tenant);
      CREATE INDEX IF NOT EXISTS audit_tenant_seq ON audit(tenant,seq);
      CREATE TABLE IF NOT EXISTS embeddings(tenant TEXT, model TEXT, fingerprint TEXT, body TEXT NOT NULL, PRIMARY KEY(tenant,model,fingerprint));
      INSERT OR IGNORE INTO schema_version VALUES(2);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS connections(tenant TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,id));
      CREATE TABLE IF NOT EXISTS collection_jobs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,idem TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(tenant,idem));
      CREATE INDEX IF NOT EXISTS collection_state ON collection_jobs(json_extract(body,'$.state'),tenant);
      CREATE TABLE IF NOT EXISTS deployment_events(tenant TEXT NOT NULL,environment TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,environment,id));
      INSERT OR IGNORE INTO schema_version VALUES(3);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,idem TEXT NOT NULL,request_hash TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(tenant,idem));
      CREATE TABLE IF NOT EXISTS workflow_locks(tenant TEXT NOT NULL,resource TEXT NOT NULL,workflow TEXT NOT NULL,PRIMARY KEY(tenant,resource));
      CREATE TABLE IF NOT EXISTS workflow_outbox(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS workflow_state ON workflows(json_extract(body,'$.state'),tenant);
      INSERT OR IGNORE INTO schema_version VALUES(4);`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  workflow(tenant,id) { const r=this.db.prepare('SELECT body FROM workflows WHERE tenant=? AND id=?').get(tenant,id);return r?JSON.parse(r.body):null; }
  workflowKey(tenant,key) { return this.db.prepare('SELECT id,request_hash FROM workflows WHERE tenant=? AND idem=?').get(tenant,key); }
  workflowEvent(tenant,input) { return this.db.prepare("SELECT id,request_hash FROM workflows WHERE tenant=? AND json_extract(body,'$.binding')=? AND json_extract(body,'$.source')=? AND json_extract(body,'$.externalId')=?").get(tenant,input.binding,input.source,input.externalId); }
  workflows(tenant) { return this.db.prepare('SELECT body FROM workflows WHERE tenant=? ORDER BY rowid DESC LIMIT 200').all(tenant).map(r=>JSON.parse(r.body)); }
  workflowSummaries(tenant) { return this.db.prepare("SELECT json_remove(body,'$.snapshots','$.evidence','$.analysis','$.review','$.plan','$.receipts','$.compensations','$.verification','$.trace','$.intent','$.approval') AS body FROM workflows WHERE tenant=? ORDER BY rowid DESC LIMIT 200").all(tenant).map(r=>JSON.parse(r.body)); }
  workflowActive(tenant,binding,resource) { return Boolean(this.db.prepare("SELECT 1 FROM workflows WHERE tenant=? AND json_extract(body,'$.binding')=? AND json_extract(body,'$.resource')=? AND json_extract(body,'$.state') NOT IN ('COMPLETED','COMPENSATED','CANCELLED') LIMIT 1").get(tenant,binding,resource)); }
  workflowPending() { return this.db.prepare("SELECT body FROM workflows WHERE json_extract(body,'$.state') IN ('QUEUED','INVESTIGATING','EXECUTING','VERIFYING','COMPENSATING') AND (json_extract(body,'$.retryAt') IS NULL OR json_extract(body,'$.retryAt')<=?) ORDER BY rowid").all(now()).map(r=>JSON.parse(r.body)); }
  workflowCount(tenant) { return this.db.prepare("SELECT count(*) AS n FROM workflows WHERE tenant=? AND json_extract(body,'$.state') NOT IN ('COMPLETED','COMPENSATED','CANCELLED')").get(tenant).n; }
  insertWorkflow(c,key,hash) { this.db.prepare('INSERT INTO workflows VALUES(?,?,?,?,?)').run(c.id,c.tenant,key,hash,JSON.stringify(c)); }
  saveWorkflow(c) { c.updatedAt=now();this.db.prepare('UPDATE workflows SET body=? WHERE tenant=? AND id=?').run(JSON.stringify(c),c.tenant,c.id); }
  lockWorkflow(c,resources) { for(const resource of resources){const owner=this.db.prepare('SELECT workflow FROM workflow_locks WHERE tenant=? AND resource=?').get(c.tenant,resource);if(owner && owner.workflow!==c.id)throw new Error('Resource is owned by another active workflow');this.db.prepare('INSERT OR IGNORE INTO workflow_locks VALUES(?,?,?)').run(c.tenant,resource,c.id);} }
  unlockWorkflow(c) { this.db.prepare('DELETE FROM workflow_locks WHERE tenant=? AND workflow=?').run(c.tenant,c.id); }
  putDelivery(d) { this.db.prepare('INSERT INTO workflow_outbox VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(d.id,d.tenant,JSON.stringify(d)); }
  deliveries(tenant) { return this.db.prepare('SELECT body FROM workflow_outbox WHERE tenant=? ORDER BY rowid DESC LIMIT 100').all(tenant).map(r=>JSON.parse(r.body)); }
  deliveryPending() { return this.db.prepare("SELECT body FROM workflow_outbox WHERE json_extract(body,'$.state')='PENDING' AND json_extract(body,'$.nextAt')<=? ORDER BY rowid LIMIT 20").all(now()).map(r=>JSON.parse(r.body)); }
  change(tenant, id) { const r = this.db.prepare('SELECT body FROM changes WHERE tenant=? AND id=?').get(tenant, id); return r ? JSON.parse(r.body) : null; }
  list(tenant) { return this.db.prepare('SELECT body FROM changes WHERE tenant=? ORDER BY rowid DESC LIMIT 200').all(tenant).map(r => JSON.parse(r.body)); }
  summaries(tenant) { return this.db.prepare(`SELECT json_object('id',id,'title',json_extract(body,'$.title'),'environment',json_extract(body,'$.environment'),'sector',json_extract(body,'$.sector'),'state',json_extract(body,'$.state'),'kind',json_extract(body,'$.kind'),'risk',json_extract(body,'$.risk'),'replicas',json_extract(body,'$.replicas'),'poolPerReplica',json_extract(body,'$.poolPerReplica'),'capacityBudget',json_extract(body,'$.capacityBudget'),'updatedAt',json_extract(body,'$.updatedAt')) AS body FROM changes WHERE tenant=? ORDER BY rowid DESC LIMIT 200`).all(tenant).map(r => JSON.parse(r.body)); }
  documentSummaries(tenant) { return this.db.prepare("SELECT json_remove(body,'$.text') AS body FROM documents WHERE tenant=?").all(tenant).map(r => JSON.parse(r.body)); }
  all() { return this.db.prepare('SELECT body FROM changes').all().map(r => JSON.parse(r.body)); }
  pendingCount(tenant) { return this.db.prepare("SELECT count(*) AS n FROM changes WHERE tenant=? AND json_extract(body,'$.state') IN ('QUEUED','INVESTIGATING','EXECUTE_QUEUED','VERIFYING')").get(tenant).n; }
  pending() { return this.db.prepare("SELECT body FROM changes WHERE json_extract(body,'$.state') IN ('VERIFYING','QUEUED','EXECUTE_QUEUED') ORDER BY CASE json_extract(body,'$.state') WHEN 'VERIFYING' THEN 0 ELSE 1 END,rowid").all().map(r => JSON.parse(r.body)); }
  embedding(tenant, model, fingerprint) { const r = this.db.prepare('SELECT body FROM embeddings WHERE tenant=? AND model=? AND fingerprint=?').get(tenant,model,fingerprint); return r ? JSON.parse(r.body) : null; }
  putEmbedding(tenant, model, fingerprint, vector) { this.db.prepare('INSERT OR REPLACE INTO embeddings VALUES(?,?,?,?)').run(tenant,model,fingerprint,JSON.stringify(vector)); }
  clearEmbeddings(tenant) { this.db.prepare('DELETE FROM embeddings WHERE tenant=?').run(tenant); }
  byKey(tenant, key) { return this.db.prepare('SELECT id,request_hash FROM changes WHERE tenant=? AND idem=?').get(tenant, key); }
  connection(tenant,id) { const r=this.db.prepare('SELECT body FROM connections WHERE tenant=? AND id=?').get(tenant,id);return r?JSON.parse(r.body):null; }
  connections(tenant) { return this.db.prepare('SELECT body FROM connections WHERE tenant=? ORDER BY id').all(tenant).map(r=>JSON.parse(r.body)); }
  putConnection(tenant,c) { this.db.prepare('INSERT INTO connections VALUES(?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET body=excluded.body').run(tenant,c.id,JSON.stringify(c)); }
  collection(tenant,id) { const r=this.db.prepare('SELECT body FROM collection_jobs WHERE tenant=? AND id=?').get(tenant,id);return r?JSON.parse(r.body):null; }
  collectionByKey(tenant,key) { const r=this.db.prepare('SELECT body FROM collection_jobs WHERE tenant=? AND idem=?').get(tenant,key);return r?JSON.parse(r.body):null; }
  collections(tenant) { return this.db.prepare('SELECT body FROM collection_jobs WHERE tenant=? ORDER BY rowid DESC LIMIT 100').all(tenant).map(r=>JSON.parse(r.body)); }
  collectionPending() { return this.db.prepare("SELECT body FROM collection_jobs WHERE json_extract(body,'$.state') IN ('QUEUED','COLLECTING') ORDER BY rowid").all().map(r=>JSON.parse(r.body)); }
  collectionCount(tenant) { return this.db.prepare("SELECT count(*) AS n FROM collection_jobs WHERE tenant=? AND json_extract(body,'$.state') IN ('QUEUED','COLLECTING')").get(tenant).n; }
  insertCollection(c,key) { this.db.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?)').run(c.id,c.tenant,key,JSON.stringify(c)); }
  saveCollection(c) { c.updatedAt=now();this.db.prepare('UPDATE collection_jobs SET body=? WHERE tenant=? AND id=?').run(JSON.stringify(c),c.tenant,c.id); }
  deployments(tenant,environment) { return this.db.prepare("SELECT body FROM deployment_events WHERE tenant=? AND environment=? AND json_extract(body,'$.at')>=? ORDER BY json_extract(body,'$.at') DESC LIMIT 80").all(tenant,environment,new Date(Date.now()-86400000).toISOString()).map(r=>JSON.parse(r.body)); }
  deployment(tenant,environment,id) { const r=this.db.prepare('SELECT body FROM deployment_events WHERE tenant=? AND environment=? AND id=?').get(tenant,environment,id);return r?JSON.parse(r.body):null; }
  putDeployment(tenant,environment,d) { this.db.prepare('INSERT INTO deployment_events VALUES(?,?,?,?)').run(tenant,environment,d.id,JSON.stringify(d)); }
  insert(c, key, requestHash) { this.db.prepare('INSERT INTO changes VALUES(?,?,?,?,?)').run(c.id, c.tenant, key, requestHash, JSON.stringify(c)); }
  save(c) { c.updatedAt = now(); this.db.prepare('UPDATE changes SET body=? WHERE tenant=? AND id=?').run(JSON.stringify(c), c.tenant, c.id); }
  docs(tenant) { return this.db.prepare('SELECT body FROM documents WHERE tenant=?').all(tenant).map(r => JSON.parse(r.body)); }
  doc(tenant, id) { const r = this.db.prepare('SELECT body FROM documents WHERE tenant=? AND id=?').get(tenant,id); return r ? JSON.parse(r.body) : null; }
  putDoc(tenant, d) { d.digest = digest({ title: d.title, source: d.source, text: d.text, expiresAt: d.expiresAt }); this.db.prepare('INSERT INTO documents VALUES(?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET body=excluded.body').run(d.id, tenant, JSON.stringify(d)); this.clearEmbeddings(tenant); }
  deleteDoc(tenant, id) { this.db.prepare('DELETE FROM documents WHERE tenant=? AND id=?').run(tenant, id); this.clearEmbeddings(tenant); }
  target(tenant) { const r = this.db.prepare('SELECT body FROM targets WHERE tenant=?').get(tenant); return r ? JSON.parse(r.body) : null; }
  putTarget(tenant, target) { this.db.prepare('INSERT INTO targets VALUES(?,?) ON CONFLICT(tenant) DO UPDATE SET body=excluded.body').run(tenant, JSON.stringify(target)); }
  audit(tenant, actor, event, details = {}) {
    const previous = this.db.prepare('SELECT hash FROM audit WHERE tenant=? ORDER BY seq DESC LIMIT 1').get(tenant)?.hash ?? 'genesis';
    const body = { at: now(), actor, event, details, previous };
    const hash = digest(body);
    this.db.prepare('INSERT INTO audit(tenant,body,hash) VALUES(?,?,?)').run(tenant, JSON.stringify(body), hash);
  }
  events(tenant) { return this.db.prepare('SELECT seq,body,hash FROM audit WHERE tenant=? ORDER BY seq').all(tenant).map(r => ({ seq: r.seq, ...JSON.parse(r.body), hash: r.hash })); }
  eventPage(tenant,{after,limit=500}={}) {
    if(!Number.isSafeInteger(limit)||limit<1||limit>1000||after!==undefined&&(!Number.isSafeInteger(after)||after<0))throw new Error('Invalid audit pagination');
    const rows=after===undefined?this.db.prepare('SELECT seq,body,hash FROM audit WHERE tenant=? ORDER BY seq DESC LIMIT ?').all(tenant,limit).reverse():this.db.prepare('SELECT seq,body,hash FROM audit WHERE tenant=? AND seq>? ORDER BY seq LIMIT ?').all(tenant,after,limit);
    return rows.map(r=>({seq:r.seq,...JSON.parse(r.body),hash:r.hash}));
  }
  close() { this.db.close(); }
}
