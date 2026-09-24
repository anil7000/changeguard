import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { Engine } from '../src/engine.mjs';
import { Automation } from '../src/automation.mjs';
import { trustedSource } from '../src/connectors.mjs';
import { incidentBundle } from '../examples/incident-bundle.mjs';
const user={id:'operator',tenant:'a',roles:['operator','admin']};
const connection={id:'metrics',environment:'production',type:'prometheus',endpoint:'https://metrics.example.com',enabled:true,intervalSeconds:60,baselineMinutes:15,mode:'always',question:'Investigate degradation',services:incidentBundle().services,queries:[{id:'pressure',service:'database',metric:'saturation',expression:'avg(database_saturation)',limit:0.8}]};
function setup(t,collector=async()=>incidentBundle()){
  const store=new Store(':memory:');const config={users:[{...user}],connectorOrigins:[{tenant:'a',origin:'https://metrics.example.com'}]};
  const engine=new Engine(store,config);engine.seed(['a']);const automation=new Automation(store,engine,config,collector);
  t.after(async()=>{await automation.stop();await engine.stop();store.close();});
  const saved=automation.configure(user,connection);return{store,config,engine,automation,saved};
}
test('A1: stale connection edits cannot re-enable a source disabled by another administrator',t=>{
  const {automation,saved}=setup(t);automation.configure(user,{...saved,enabled:false});
  assert.throws(()=>automation.configure(user,{...saved,question:'Old browser draft'}),/revision|changed/i);
});
test('A2: remote source credentials cannot travel over cleartext HTTP',()=>{
  assert.throws(()=>trustedSource({connectorOrigins:[{tenant:'a',origin:'http://metrics.example.com',secretEnv:'CG_SOURCE_METRICS'}]},'a','http://metrics.example.com'),/HTTPS|encrypted/i);
});
test('A3: repeated schedule ticks cannot stack collections while the same source is pending',t=>{
  const {store,automation,saved}=setup(t);
  for(let i=0;i<3;i++){store.putConnection('a',{...saved,nextRunAt:new Date(Date.now()-1000-i).toISOString()});automation.schedule();}
  assert.equal(store.collectionCount('a'),1);
});
test('A4: revoking collector authority during source I/O prevents assessment submission',async t=>{
  let configRef;const {store,config,automation}=setup(t,async()=>{configRef.users[0].roles=['viewer'];return incidentBundle();});configRef=config;
  const job=automation.enqueue(user,'metrics','revocation-test');await automation.run(job);
  assert.equal(store.collection('a',job.id).state,'FAILED');assert.equal(store.list('a').length,0);
});
test('A5: audit polling is bounded and supports lossless forward pagination',t=>{
  const {store}=setup(t);for(let i=0;i<1200;i++)store.audit('a','test','event',{i});
  const recent=store.eventPage('a');assert.equal(recent.length,500);
  const first=store.eventPage('a',{after:0,limit:700});assert.equal(first.length,700);
  const next=store.eventPage('a',{after:first.at(-1).seq,limit:700});
  assert.equal(first.length+next.length,store.events('a').length);
  assert.ok(next[0].seq>first.at(-1).seq);assert.deepEqual(store.eventPage('b'),[]);
});
