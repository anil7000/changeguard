import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store, digest } from '../src/store.mjs';
import { Engine, POLICY } from '../src/engine.mjs';
import { propose } from '../src/intelligence.mjs';

const user = { id: 'operator', tenant: 'a', roles: ['operator'] };
const reviewer = { id: 'reviewer', tenant: 'a', roles: ['approver'] };
const valid = { title: 'Pool deployment', sector: 'saas', replicas: 2, poolPerReplica: 10, capacityBudget: 40, evidenceFresh: true, rollbackTested: true };
function fixture(t) { const store = new Store(':memory:'); t.after(() => store.close()); const engine = new Engine(store, { users: [user, reviewer] }); engine.seed(['a']); return { store, engine }; }

test('R1: malformed and future safety timestamps fail closed', t => {
  const { store, engine } = fixture(t);
  const d = store.docs('a')[0];
  const c = { tenant: 'a', requester: user.id, policyVersion: POLICY, investigatedAt: new Date().toISOString(), evidence: [{ documentId: d.id, digest: d.digest }], action: { expectedRevision: 1 } };
  c.approval = { approver: reviewer.id, actionDigest: digest(c.action), expiresAt: 'invalid' };
  assert.throws(() => engine.preflight(c), /Approval/);
  c.approval.expiresAt = new Date(Date.now() + 60000).toISOString();
  for (const time of ['invalid', new Date(Date.now() + 60000).toISOString()]) { c.investigatedAt = time; assert.throws(() => engine.preflight(c), /Investigation/); }
});

test('R2: completed history cannot hide pending work from tenant quota', t => {
  const { store, engine } = fixture(t);
  for (let i = 0; i < 20; i++) engine.submit(user, valid, `pending-${i}`);
  for (let i = 0; i < 201; i++) store.insert({ id: `old-${i}`, tenant: 'a', state: 'COMPLETED' }, `complete-${i}`, 'x');
  assert.throws(() => engine.submit(user, valid, 'overflow-new'), /queue limit/);
});

test('R3: idle worker does not deserialize completed history', async t => {
  const { store, engine } = fixture(t);
  store.all = () => { throw new Error('Full history scan'); };
  await engine.tick();
});
test('R2 extension: execution requests obey the same pending-work quota',t=>{
  const {store,engine}=fixture(t);for(let i=0;i<20;i++)engine.submit(user,valid,`pending-${i}`);
  store.insert({id:'approved',tenant:'a',state:'APPROVED'},'approved-key','hash');engine.preflight=()=>{};
  assert.throws(()=>engine.execute(user,'approved'),/queue limit/);assert.equal(store.change('a','approved').state,'APPROVED');
});
test('legacy assessments without structured grounding are held on restart',t=>{
  const {store,engine}=fixture(t);store.insert({id:'legacy',tenant:'a',kind:'assessment',state:'ANALYZED',analysis:{hypotheses:[]}},'legacy-assessment','hash');
  engine.seed(['a']);assert.equal(store.change('a','legacy').state,'HELD');assert.ok(store.events('a').some(e=>e.event==='legacy-assessment-held'));
});

test('R4: unavailable mandatory AI cannot become a successful deterministic analysis', async () => {
  await assert.rejects(propose(valid, [], {}), /model|AI|LLM/i);
});

test('R5: empty AI findings cannot pass structured analysis validation', async t => {
  const server = createServer((req, res) => res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Looks safe', hypotheses: [] }) } }] })));
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  await assert.rejects(propose(valid, [{ documentId: 'runbook' }], { llm: { url: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, model: 'test' } }), /analysis|hypothes|finding/i);
});
