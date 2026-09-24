import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store } from '../src/store.mjs';
import { chat, embed } from '../src/model.mjs';
import { hybridRetrieve } from '../src/intelligence.mjs';
import { Engine } from '../src/engine.mjs';
import { incidentBundle } from '../examples/incident-bundle.mjs';
import { modelFixture } from './model-fixture.mjs';
import { validateBundle, validateGrounding, runTool } from '../src/investigation.mjs';
test('real-model regression: reverse dependency paths, causal certainty and numerical inventions are rejected',()=>{
  const b=incidentBundle();const evidence=[{documentId:'runbook'}];const observations=[{documentId:'tool:telemetry_compare'}];
  const valid={sourceService:'database',affectedServices:['checkout'],mechanism:'Connection pressure may affect its consumers.',verification:'Inspect the source telemetry.',observations:['tool:telemetry_compare'],runbooks:['runbook']};
  for(const patch of [{sourceService:'checkout',affectedServices:['payments']},{sourceService:'missing'},{mechanism:'Saturation caused checkout failure.'},{mechanism:'Latency rose to 999 ms.'},{observations:['runbook']},{runbooks:[]}])assert.throws(()=>validateGrounding({hypotheses:[{...valid,...patch}]},b,evidence,observations));
  assert.match(validateGrounding({hypotheses:[valid]},b,evidence,observations)[0].claim,/Unverified hypothesis/);
});
test('all seven metric directions are handled and equality is not a breach',()=>{
  for(const metric of ['error_rate','latency_p95_ms','saturation','queue_depth','availability','replication_lag_s','certificate_days']){
    const lower=['availability','certificate_days'].includes(metric);const b=incidentBundle();b.signals=[{...b.signals[0],metric,before:0.5,limit:0.5,after:lower?0.1:0.9}];
    assert.equal(runTool('telemetry_compare',validateBundle(b)).observations[0].breached,true);b.signals[0].after=0.5;assert.equal(runTool('telemetry_compare',b).observations[0].breached,false);
  }
});
test('compatible embedding responses must have unique in-range indexes',async t=>{
  const c=await endpoint(t,(req,res)=>res.end(JSON.stringify({data:[{index:0,embedding:[1,2]},{index:0,embedding:[3,4]}]})));c.llm.provider='openai-compatible';
  await assert.rejects(embed(c,['a','b']),/indexes/);
});
test('service identities cannot be missing or coerced from numeric values',()=>{
  for(const id of [undefined,123]) { const b=incidentBundle();b.services=[{id,owner:'team',tier:'standard',dependsOn:[]}];b.signals=[{...b.signals[0],service:id}];b.deployments=[];assert.throws(()=>validateBundle(b),/service ID/); }
});
async function endpoint(t,handler) { const s=createServer(handler); await new Promise(r=>s.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>s.close(r))); return {llm:{provider:'ollama',model:'test',embeddingModel:'test',url:`http://127.0.0.1:${s.address().port}/chat`,embeddingUrl:`http://127.0.0.1:${s.address().port}/embed`,timeoutMs:1000}}; }
test('malformed, zero and mismatched embedding vectors fail closed',async t=>{
  for(const embeddings of [[[0,0]],[[1,2],[1]],[[1,null]],[]]) { const c=await endpoint(t,(req,res)=>res.end(JSON.stringify({embeddings}))); await assert.rejects(embed(c,['hello']),/embedding/); }
});
test('model redirects are not followed and oversized responses are rejected',async t=>{
  const redirect=await endpoint(t,(req,res)=>{res.writeHead(302,{location:'http://127.0.0.1:1/private'});res.end();});
  await assert.rejects(chat(redirect,'test',{}),/Model unavailable/);
  const oversized=await endpoint(t,(req,res)=>res.end('x'.repeat(70000)));
  await assert.rejects(chat(oversized,'test',{}),/budget/);
  await assert.rejects(chat(oversized,'test',{payload:'x'.repeat(21000)}),/context/);
});
test('truncated model completions and transport failures never masquerade as valid reports',async t=>{
  const c=await endpoint(t,(req,res)=>res.end(JSON.stringify({done:true,done_reason:'length',message:{content:'{}'}})));
  await assert.rejects(chat(c,'test',{}),/truncated/);
});
test('summary polling does not expose full operational bundles or runbook bodies',()=>{
  const store=new Store(':memory:');
  try {store.insert({id:'one',tenant:'a',state:'ANALYZED',title:'test',bundle:{secret:'sensitive operational context'},analysis:{summary:'long'}},'key','hash');store.putDoc('a',{id:'doc',title:'test',text:'runbook contents',source:'reviewed',expiresAt:'2099-01-01'});
    assert.equal(store.summaries('a')[0].bundle,undefined);assert.equal(store.documentSummaries('a')[0].text,undefined);assert.equal(store.summaries('b').length,0);
  }finally{store.close();}
});
test('evidence withdrawal during model reasoning holds the assessment',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  const model=await modelFixture(t,{reply:({system,output})=>{if(system.includes('skeptical'))store.deleteDoc('a','seed-pool-runbook');return output;}});
  const user={id:'engineer',tenant:'a',roles:['operator']};const engine=new Engine(store,{users:[user],llm:model.llm});engine.seed(['a']);
  const c=engine.submit(user,{kind:'assessment',title:'Failure',sector:'saas',bundle:incidentBundle()},'withdrawal-001');await engine.tick();
  assert.equal(store.change('a',c.id).state,'HELD');assert.match(store.change('a',c.id).reason,/Evidence/);
});
test('embedding model dimension drift cannot poison cached rankings',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());store.putDoc('a',{id:'doc',title:'pool',text:'Connection pool pressure during rollouts.',source:'test',expiresAt:'2099-01-01'});
  let count=0;const c=await endpoint(t,async(req,res)=>{for await(const part of req){};count++;res.end(JSON.stringify({embeddings:[count===1?[1,2]:[1,2,3]]}));});
  await assert.rejects(hybridRetrieve(store,'a','pool',c),/dimension/);assert.equal(store.db.prepare('SELECT count(*) AS n FROM embeddings').get().n,0);
});
