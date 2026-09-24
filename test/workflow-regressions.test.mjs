import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './workflow-fixture.mjs';

test('R1: duplicate source event with a new delivery key is one workflow',async t=>{
  const f=await fixture(t);const first=f.submit();assert.equal(f.submit('delivery-0002').id,first.id);
});
test('R2: final verification rejects an external revision even when values match',async t=>{
  const f=await fixture(t);const c=f.submit();await f.workflows.investigate(c);await f.workflows.execute(c);
  f.mutate('inventory',{status:'reserved'});c.state='VERIFYING';await f.workflows.run(c);assert.notEqual(c.state,'COMPLETED');
});
test('R3: after lost acknowledgment, changed business authority prevents a later action',async t=>{
  let drop=true;const f=await fixture(t,{faults:{inventory:{dropResponse:()=>{const result=drop;drop=false;return result;}}}});
  const c=f.submit();await f.workflows.run(c);assert.equal(c.state,'EXECUTING');assert.ok(c.intent);
  f.mutate('payment',{status:'refunded'});const resumed=f.store.workflow('a',c.id);await f.workflows.run(resumed);
  assert.equal(resumed.state,'HELD');assert.equal(f.services.fulfillment.read('demo-1').data.status,'blocked');assert.equal(f.services.inventory.read('demo-1').version,2);
});
test('R4: expired approval is rejected even when timestamp is malformed',async t=>{
  const f=await fixture(t,{mode:'approval'});const c=f.submit();await f.workflows.run(c);const approved=f.workflows.approve(f.reviewer,c.id);approved.approval.expiresAt='not-a-date';await f.workflows.run(approved);assert.equal(approved.state,'HELD');assert.equal(approved.receipts.length,0);
});
test('R5: known second-action rejection automatically compensates the first action',async t=>{
  const f=await fixture(t);const c=f.submit();await f.workflows.investigate(c);
  const original=f.workflows.adapter;f.workflows.adapter=(tenant,b)=>{const a=original(tenant,b);if(b.endpoint===f.services.fulfillment.url)a.apply=async()=>{const e=new Error('Adapter returned HTTP 409');e.status=409;throw e;};return a;};
  await f.workflows.run(c);if(c.state==='COMPENSATING')await f.workflows.run(c);
  assert.equal(c.state,'COMPENSATED',c.reason);assert.equal(f.services.inventory.read('demo-1').data.status,'available');
});
test('R6: revoked approval cannot allow a write after model or network wait',async t=>{
  const f=await fixture(t,{mode:'approval'});const c=f.submit();await f.workflows.run(c);const approved=f.workflows.approve(f.reviewer,c.id);f.config.users[1].roles=['viewer'];await f.workflows.run(approved);assert.equal(approved.state,'HELD');assert.equal(approved.receipts.length,0);
});
test('R7: resumed uncertain action does not bypass changed target preconditions',async t=>{
  const f=await fixture(t);const c=f.submit();await f.workflows.investigate(c);
  const step=c.plan[0];c.intent={id:c.id+'-0',kind:'apply',resource:c.resource,role:step.role,expectedVersion:step.expectedVersion,from:step.from,to:step.to,workflow:c.id};c.state='HELD';f.workflows.save(c,'test-intent');
  f.mutate('payment',{status:'refunded'});const resumed=f.workflows.resume(f.user,c.id);await f.workflows.run(resumed);assert.equal(f.services.inventory.read('demo-1').data.status,'available');
});
