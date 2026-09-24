import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { start } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { Engine } from '../src/engine.mjs';
import { Automation } from '../src/automation.mjs';
import { ConnectorError, trustedSource, validateConnection, collectPrometheus, parseSample, alertEvent } from '../src/connectors.mjs';
import { incidentBundle } from '../examples/incident-bundle.mjs';
import { modelFixture } from './model-fixture.mjs';
const user={id:'engineer',tenant:'a',roles:['viewer','operator','admin'],token:randomBytes(32).toString('hex')};
function connection(endpoint){return {id:'metrics',type:'prometheus',environment:'production',endpoint,enabled:true,intervalSeconds:0,baselineMinutes:15,mode:'on-breach',question:'Investigate checkout degradation',services:incidentBundle().services,queries:[{id:'db-pressure',service:'database',metric:'saturation',limit:0.8,expression:'avg(database_saturation)'}]};}
async function source(t,reply){const calls=[];const server=createServer((req,res)=>{const url=new URL(req.url,'http://localhost');calls.push({url,authorization:req.headers.authorization});const time=Number(url.searchParams.get('time'));res.setHeader('content-type','application/json');if(reply)return reply(req,res,url);res.end(JSON.stringify({status:'success',data:{resultType:'vector',result:[{metric:{},value:[time,time<Date.now()/1000-60?'0.4':'0.96']}]}}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return {endpoint:'http://127.0.0.1:'+server.address().port,calls};}
function memory(t,endpoint,collector){const store=new Store(':memory:');const config={users:[structuredClone(user)],connectorOrigins:[{tenant:'a',origin:endpoint}]};const engine=new Engine(store,config);engine.seed(['a']);const automation=new Automation(store,engine,config,collector);automation.configure(user,connection(endpoint));t.after(async()=>{await automation.stop();await engine.stop();store.close();});return {store,config,engine,automation};}
test('Prometheus collector reads before/after metrics, preserving service graph and deployment evidence',async t=>{
  const remote=await source(t);const config={connectorOrigins:[{tenant:'a',origin:remote.endpoint}]};
  const b=await collectPrometheus(connection(remote.endpoint),config,'a',incidentBundle().deployments);
  assert.equal(remote.calls.length,2);assert.equal(b.signals[0].before,0.4);assert.equal(b.signals[0].after,0.96);assert.equal(b.deployments.length,1);assert.equal(b.services.length,3);
  assert.ok(remote.calls.every(c=>c.url.pathname==='/api/v1/query'));
});
test('source trust is tenant-scoped, rejects metadata, URL credentials and unsupported types',()=>{
  const config={connectorOrigins:[{tenant:'a',origin:'https://metrics.example.com'}]};
  assert.throws(()=>trustedSource(config,'b','https://metrics.example.com'),/authorized/);
  for(const url of ['http://169.254.169.254','https://user:secret@metrics.example.com','file:///etc/passwd'])assert.throws(()=>trustedSource(config,'a',url));
  assert.throws(()=>validateConnection({...connection('https://metrics.example.com'),type:'shell'},config,'a'));
});
test('empty, ambiguous, stale, partial and non-finite telemetry cannot be interpreted as healthy',()=>{
  const time=Date.now()/1000;
  for(const data of [
    {status:'success',data:{resultType:'vector',result:[]}},
    {status:'success',data:{resultType:'vector',result:[{},{}]}},
    {status:'success',data:{resultType:'scalar',result:[time-300,'0']}},
    {status:'success',warnings:['partial'],data:{resultType:'scalar',result:[time,'0']}},
    ...['NaN','+Inf','','-1'].map(v=>({status:'success',data:{resultType:'scalar',result:[time,v]}}))
  ])assert.throws(()=>parseSample(data,time));
});
test('source redirects are rejected and tokens never reach the redirect destination',async t=>{
  let leaked=false;const destination=await source(t,(req,res)=>{leaked=true;res.end('{}');});
  const remote=await source(t,(req,res)=>{res.writeHead(302,{location:destination.endpoint});res.end();});
  const env='CG_SOURCE_REDIRECT_TEST';process.env[env]='private-test-token';t.after(()=>delete process.env[env]);
  const config={connectorOrigins:[{tenant:'a',origin:remote.endpoint,secretEnv:env}]};
  await assert.rejects(collectPrometheus(connection(remote.endpoint),config,'a'),/redirected/);assert.equal(leaked,false);
});
test('oversized source responses and query cardinality are bounded',async t=>{
  const remote=await source(t,(req,res)=>res.end(' '.repeat(1024*1024+1)));
  await assert.rejects(collectPrometheus(connection(remote.endpoint),{connectorOrigins:[{tenant:'a',origin:remote.endpoint}]},'a'),/1 MiB/);
  assert.throws(()=>validateConnection({...connection(remote.endpoint),queries:Array(13).fill(connection(remote.endpoint).queries[0])},{connectorOrigins:[{tenant:'a',origin:remote.endpoint}]},'a'),/1-12/);
});
test('webhook retries are deduplicated regardless of alert order or annotations',t=>{
  const {store,automation}=memory(t,'https://metrics.example.com',async()=>incidentBundle());
  const alerts=['one','two'].map(fingerprint=>({status:'firing',fingerprint,startsAt:new Date().toISOString(),annotations:{instructions:'fetch http://169.254.169.254'}}));
  const first=automation.webhook(user,'metrics',{version:'4',status:'firing',alerts});
  const second=automation.webhook(user,'metrics',{version:'4',status:'firing',alerts:[...alerts].reverse()});
  assert.equal(first.id,second.id);assert.equal(store.collectionCount('a'),1);
  assert.equal(automation.webhook(user,'metrics',{version:'4',status:'resolved',alerts:alerts.map(a=>({...a,status:'resolved'}))}).status,'ignored');
  assert.throws(()=>alertEvent({version:'4',status:'firing',alerts,truncatedAlerts:1}),/Truncated/);
});
test('connection disable during collection prevents model submission',async t=>{
  let ctx;ctx=memory(t,'https://metrics.example.com',async()=>{const c=ctx.store.connection('a','metrics');ctx.automation.configure(user,{...c,enabled:false});return incidentBundle();});
  const job=ctx.automation.enqueue(user,'metrics','disable-inflight');await ctx.automation.run(job);assert.equal(ctx.store.collection('a',job.id).state,'FAILED');assert.equal(ctx.store.list('a').length,0);
});
test('restart after committed assessment does not recollect or create a duplicate',async t=>{
  const ctx=memory(t,'https://metrics.example.com',async()=>{throw new Error('must not recollect');});
  const job=ctx.automation.enqueue(user,'metrics','restart-commit');
  const assessment=ctx.engine.submit(user,{kind:'assessment',title:'Recovered',bundle:incidentBundle()},'collection-'+job.id);
  job.state='COLLECTING';ctx.store.saveCollection(job);const restarted=new Automation(ctx.store,ctx.engine,ctx.config,async()=>{throw new Error('must not recollect');});
  await restarted.run(ctx.store.collection('a',job.id));assert.equal(ctx.store.collection('a',job.id).assessmentId,assessment.id);assert.equal(ctx.store.list('a').length,1);await restarted.stop();
});
test('transient source failures retry at most three times and never create an assessment',async t=>{
  const ctx=memory(t,'https://metrics.example.com',async()=>{throw new ConnectorError('Source unavailable',true);});
  const job=ctx.automation.enqueue(user,'metrics','retry-budget');for(let i=0;i<3;i++)await ctx.automation.run(job);
  assert.equal(ctx.store.collection('a',job.id).state,'FAILED');assert.equal(job.attempts,3);assert.equal(ctx.store.list('a').length,0);
});
test('healthy collection skips costly AI calls; paused collection cannot be queued',async t=>{
  const ctx=memory(t,'https://metrics.example.com',async()=>{const b=incidentBundle();b.signals.forEach(s=>s.after=s.before);return b;});
  const job=ctx.automation.enqueue(user,'metrics','healthy-case');await ctx.automation.run(job);
  assert.equal(ctx.store.collection('a',job.id).state,'HEALTHY');assert.equal(ctx.store.list('a').length,0);
  ctx.config.automationPaused=true;assert.throws(()=>ctx.automation.enqueue(user,'metrics','paused-case'),/paused/);
});
test('scheduled collection runs autonomously through model review without an operator submission',async t=>{
  const ctx=memory(t,'https://metrics.example.com',async()=>incidentBundle());
  ctx.config.llm=(await modelFixture(t)).llm;
  const c=ctx.store.connection('a','metrics');ctx.store.putConnection('a',{...c,intervalSeconds:60,nextRunAt:new Date(Date.now()-1000).toISOString()});
  ctx.automation.tick();await ctx.automation.stop();const job=ctx.store.collections('a')[0];
  assert.equal(job.trigger,'schedule');assert.equal(job.requester,'scheduler');assert.equal(job.state,'SUBMITTED',job.reason);
  await ctx.engine.tick();assert.equal(ctx.store.change('a',job.assessmentId).state,'ANALYZED');
  assert.ok(Date.parse(ctx.store.connection('a','metrics').nextRunAt)>Date.now());
});
test('HTTP integration: RBAC, tenant boundaries, deployments, collection, RAG, review and audit',async t=>{
  const remote=await source(t);const model=await modelFixture(t);const dir=mkdtempSync(join(tmpdir(),'cg-integration-'));
  const config={llm:model.llm,connectorOrigins:[{tenant:'a',origin:remote.endpoint}],users:[user,{id:'collector',tenant:'a',roles:['collector'],token:randomBytes(32).toString('hex')},{id:'viewer',tenant:'a',roles:['viewer'],token:randomBytes(32).toString('hex')},{id:'other',tenant:'b',roles:['admin','operator'],token:randomBytes(32).toString('hex')}]};
  const app=await start({config,dbPath:join(dir,'db.sqlite'),interval:10});t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  async function request(path,method='GET',body,who=0,key=randomUUID()){
    const response=await fetch(app.url+path,{method,headers:{authorization:'Bearer '+config.users[who].token,'content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};
  }
  assert.equal((await request('/api/connections','POST',connection(remote.endpoint),2)).status,403);
  assert.equal((await request('/api/connections','POST',connection(remote.endpoint),3)).status,400);
  assert.equal((await request('/api/connections','POST',connection(remote.endpoint))).status,201);
  assert.equal((await request('/api/connections','GET',undefined,1)).status,403);
  assert.deepEqual((await request('/api/connections','GET',undefined,3)).body,[]);
  const deployment=incidentBundle().deployments[0];
  assert.equal((await request('/api/environments/production/deployments','POST',deployment,1)).status,201);
  assert.equal((await request('/api/environments/production/deployments','POST',{...deployment,revision:'different'},1)).status,409);
  const collection=await request('/api/connections/metrics/collect','POST',{},1);assert.equal(collection.status,202);
  let job;let assessment;for(let i=0;i<200;i++){job=app.store.collection('a',collection.body.id);assessment=job.assessmentId&&app.store.change('a',job.assessmentId);if(assessment?.state==='ANALYZED'||assessment?.state==='HELD'||job.state==='FAILED')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(job.state,'SUBMITTED',job.reason);assert.equal(assessment.state,'ANALYZED',assessment.reason);assert.equal(assessment.environment,'production');assert.equal(assessment.bundle.deployments.length,1);
  assert.equal(assessment.action,undefined);assert.equal(app.store.target('a').revision,1);
  const push={kind:'synthetic',title:'Bypass',bundle:incidentBundle()};assert.equal((await request('/api/events/evidence','POST',push,1)).status,400);
  assert.equal((await request('/api/access','GET',undefined,2)).status,403);
  const access=(await request('/api/access')).body;assert.ok(access.users.every(u=>!u.token));assert.ok(!JSON.stringify(access).includes(user.token));
  assert.equal((await request('/api/audit?limit=1001')).status,400);assert.ok((await request('/api/audit?after=0&limit=20')).body.length<=20);
});
