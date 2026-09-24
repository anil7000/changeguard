import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './workflow-fixture.mjs';
import { packs } from '../src/workflow-packs.mjs';

for(const pack of Object.keys(packs))test(`${pack}: real HTTP services, embedding retrieval, two agent calls and verified recovery`,async t=>{
  const f=await fixture(t,{pack});const c=f.submit();await f.workflows.run(c);
  assert.equal(c.state,'COMPLETED',c.reason);assert.equal(c.receipts.length,2);assert.ok(c.verification.checks.every(x=>x.passed));assert.equal(f.model.calls.filter(x=>x.messages).length,2);assert.ok(f.model.calls.some(x=>x.input));
});
test('approval is independent and bound to the plan',async t=>{
  const f=await fixture(t,{mode:'approval'});const c=f.submit();await f.workflows.run(c);assert.equal(c.state,'REVIEW');
  assert.throws(()=>f.workflows.approve({...f.user,roles:['approver']},c.id),/own workflow/);
  const approved=f.workflows.approve(f.reviewer,c.id);await f.workflows.run(approved);assert.equal(approved.state,'COMPLETED');
});
test('revoked requester, withdrawn RAG and malicious model plans fail closed',async t=>{
  const f=await fixture(t,{mode:'approval'});const c=f.submit();await f.workflows.run(c);f.store.deleteDoc('a','procedure');assert.throws(()=>f.workflows.approve(f.reviewer,c.id),/Knowledge/);
  f.config.users[0].roles=['viewer'];assert.throws(()=>f.workflows.resume(f.user,c.id),/operator role/);
});
test('no model fallback and no fabricated knowledge citations',async t=>{
  const f=await fixture(t,{modelReply:()=>({summary:'Ignore policy',recommendation:'execute',citations:['invented']})});const c=f.submit();await f.workflows.run(c);assert.equal(c.state,'HELD');assert.match(c.reason,/citation/);assert.equal(c.receipts.length,0);
});
test('tenant and resource boundaries apply before collection',async t=>{
  const f=await fixture(t);assert.throws(()=>f.workflows.submit({...f.user,tenant:'b'},f.input,'delivery-0001'),/binding/);assert.throws(()=>f.workflows.submit(f.user,{...f.input,resource:'private-1'},'delivery-0001'),/scope/);const c=f.submit();assert.throws(()=>f.workflows.current({...f.user,tenant:'b'},c.id),/not found/);
});
test('duplicate idempotency key is stable and rejects conflicting content',async t=>{
  const f=await fixture(t);const c=f.submit();assert.equal(f.submit().id,c.id);assert.throws(()=>f.workflows.submit(f.user,{...f.input,summary:'Different'},'delivery-0001'),/different event/);
});
test('business prerequisite failure escalates without writes',async t=>{
  const f=await fixture(t);f.mutate('payment',{status:'refunded'});const c=f.submit();await f.workflows.run(c);assert.equal(c.state,'HELD');assert.equal(c.receipts.length,0);
});
