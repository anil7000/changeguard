import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, digest } from '../src/store.mjs';
import { Engine } from '../src/engine.mjs';
import { hybridRetrieve } from '../src/intelligence.mjs';
import { validateBundle, runTool, dependencyImpact } from '../src/investigation.mjs';
import { incidentBundle } from '../examples/incident-bundle.mjs';
import { modelFixture } from './model-fixture.mjs';
const user = { id: 'engineer', tenant: 'a', roles: ['operator'] };
async function setup(t, overrides) { const model = await modelFixture(t,overrides); const store = new Store(':memory:'); const config = { users: [user], llm: model.llm }; const engine = new Engine(store,config); engine.seed(['a']); t.after(() => store.close()); return { store,engine,model,config }; }
test('agent plan, four read-only tools, hybrid RAG and skeptical review produce a non-executable assessment', async t => {
  const { store,engine,model } = await setup(t);
  const c = engine.submit(user,{ kind: 'assessment', title: 'Checkout failure after database change', sector: 'retail', bundle: incidentBundle() },'incident-001');
  await engine.tick(); const result = store.change('a',c.id);
  assert.equal(result.state,'ANALYZED',result.reason); assert.equal(result.trace.length,4); assert.equal(result.risk,'critical-review');
  assert.equal(result.evidence[0].retrieval,'hybrid-rrf'); assert.equal(result.review.checks.length,result.analysis.hypotheses.length);
  assert.equal(model.calls.filter(c => c.messages).length,3); assert.equal(result.action,undefined);
  assert.throws(() => engine.execute(user,c.id),/approval/); assert.equal(store.target('a').revision,1);
});
test('unsafe agent tools and unsupported claims are held without executing anything', async t => {
  for (const mode of ['tool','review']) {
    const { store,engine } = await setup(t,{ reply: ({system,output}) => mode === 'tool' && system.includes('Plan a bounded') ? { reason: 'escape', tools: ['shell'] } : mode === 'review' && system.includes('skeptical') ? { checks: [{ index: 0, supported: false, reason: 'Unsupported certainty' }] } : output });
    const c = engine.submit(user,{ kind: 'assessment', title: 'Incident', sector: 'saas', bundle: incidentBundle() },`bad-${mode}-001`);
    await engine.tick(); assert.equal(store.change('a',c.id).state,'HELD'); assert.equal(store.target('a').revision,1);
  }
});
test('invalid, stale and cross-service evidence references are rejected', () => {
  for (const mutate of [b => b.capturedAt = 'invalid', b => b.capturedAt = '2000-01-01', b => b.services[0].dependsOn = ['missing'], b => b.signals[0].after = Infinity, b => b.signals[0].after = 4, b => b.signals[1].id = b.signals[0].id, b => b.deployments[0].at = '2099-01-01']) { const b = incidentBundle(); mutate(b); assert.throws(() => validateBundle(b),/Invalid evidence/); }
});
test('graph cycles terminate, propagation direction and temporal correlation are bounded', () => {
  const b = incidentBundle(); b.services[2].dependsOn = ['checkout'];
  assert.equal(dependencyImpact(validateBundle(b)).affected.length,3);
  assert.ok(runTool('change_correlation',b).candidates.length);
  b.deployments[0].at = new Date(Date.now()+1000).toISOString(); assert.equal(runTool('change_correlation',b).candidates.length,0);
  assert.throws(() => runTool('shell',b),/forbidden/);
});
test('embedding cache is tenant-scoped, reused and invalidated on metadata changes', async t => {
  const { store,model,config } = await setup(t);
  await hybridRetrieve(store,'a','pool pressure',config); const first = model.calls.length;
  await hybridRetrieve(store,'a','pool pressure',config); assert.equal(model.calls.length-first,1);
  const d = store.docs('a')[0]; const old = d.digest; store.putDoc('a',{ ...d, source: 'different provenance' }); assert.notEqual(store.doc('a',d.id).digest,old);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM embeddings').get().n,0);
  await assert.rejects(hybridRetrieve(store,'b','pool pressure',config),/No fresh evidence/);
});
test('tenant B makes progress while tenant A is blocked on inference; same tenant stays serialized', async t => {
  const store = new Store(':memory:'); const engine = new Engine(store,{ workerConcurrency: 2,users: [] }); engine.seed(['a','b']);
  let release; const held = new Promise(r => { release = r; }); const visited = [];
  engine.investigate = async c => { visited.push(c.tenant); if (c.tenant === 'a') await held; c.state = 'HELD'; store.save(c); };
  const data = { title: 'Assessment', sector: 'saas', kind: 'assessment', bundle: incidentBundle() };
  engine.submit(user,data,'tenant-a-one'); engine.submit(user,data,'tenant-a-two'); engine.submit({...user,tenant:'b'},data,'tenant-b-one');
  const tick = engine.tick(); await new Promise(r => setImmediate(r)); assert.deepEqual(visited,['a','b']); release(); await tick; await engine.stop(); store.close();
});
