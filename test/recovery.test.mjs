import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { start } from '../src/server.mjs';
import { Store, digest } from '../src/store.mjs';

const config = { users: [{ id: 'engineer', tenant: 'a', token: 'engineer-token-32-characters-long-example', roles: ['operator', 'admin'] }, { id: 'reviewer', tenant: 'a', token: 'reviewer-token-32-characters-long-example', roles: ['approver'] }] };
const valid = { title: 'Pool change', sector: 'saas', replicas: 2, poolPerReplica: 10, capacityBudget: 40, evidenceFresh: true, rollbackTested: true };
test('exclusive runtime ownership rejects a second process for the same database', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-lock-')); const dbPath = join(dir, 'db.sqlite');
  const app = await start({ config, dbPath });
  t.after(async () => { await app.close(); rmSync(dir, { force: true, recursive: true }); });
  await assert.rejects(start({ config, dbPath }), /owns this database/);
});
test('removed runbook stays removed after a restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-delete-')); const dbPath = join(dir, 'db.sqlite');
  let app = await start({ config, dbPath });
  t.after(async () => { await app.close(); rmSync(dir, { force: true, recursive: true }); });
  app.store.deleteDoc('a', 'seed-pool-runbook'); await app.close(); app = await start({ config, dbPath });
  assert.equal(app.store.docs('a').length, 0);
});
test('recovery resumes verification without reapplying an action', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-resume-')); const dbPath = join(dir, 'db.sqlite');
  let app = await start({ config, dbPath, interval: 60000 });
  t.after(async () => { await app.close(); rmSync(dir, { force: true, recursive: true }); });
  const c = app.engine.submit(config.users[0], valid, randomUUID()); await app.engine.tick(); app.engine.approve(config.users[1], c.id);
  const saved = app.store.change('a', c.id); const before = app.store.target('a');
  saved.state = 'VERIFYING'; saved.receipt = { operationId: c.id, before, revision: 2 };
  app.store.transaction(() => { app.store.putTarget('a', { ...before, ...valid, revision: 2, lastOperation: c.id }); app.store.save(saved); });
  await app.close(); app = await start({ config, dbPath, interval: 60000 }); await app.engine.tick();
  assert.equal(app.store.change('a', c.id).state, 'COMPLETED'); assert.equal(app.store.target('a').revision, 2);
});
test('failed postcondition restores only the synthetic fixture', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-rollback-')); const dbPath = join(dir, 'db.sqlite');
  const app = await start({ config, dbPath, interval: 60000 });
  t.after(async () => { await app.close(); rmSync(dir, { force: true, recursive: true }); });
  const c = app.engine.submit(config.users[0], valid, randomUUID()); await app.engine.tick();
  const saved = app.store.change('a', c.id); const before = app.store.target('a');
  saved.state = 'VERIFYING'; saved.receipt = { operationId: c.id, before, revision: 2 };
  app.store.putTarget('a', { ...before, replicas: 10, poolPerReplica: 30, capacityBudget: 30, revision: 2, lastOperation: c.id }); app.store.save(saved);
  await app.engine.tick(); assert.equal(app.store.change('a', c.id).state, 'ROLLED_BACK'); assert.equal(app.store.target('a').replicas, before.replicas); assert.equal(app.store.target('a').revision, 3);
});
test('SQLite transaction rollback keeps audit and state atomic', () => {
  const store = new Store(':memory:');
  try { assert.throws(() => store.transaction(() => { store.putTarget('a', { revision: 2 }); store.audit('a', 'test', 'attempt'); throw new Error('abort'); })); assert.equal(store.target('a'), null); assert.equal(store.events('a').length, 0); }
  finally { store.close(); }
});
