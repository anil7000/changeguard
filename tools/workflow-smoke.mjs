import { readFileSync } from 'node:fs';
const config=JSON.parse(readFileSync(process.env.CG_CONFIG??'data/reference/config.json','utf8'));
const base=new URL(process.env.CG_URL??'http://127.0.0.1:4315');
if(base.protocol!=='https:' && !(base.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(base.hostname)))throw new Error('Workspace credentials require HTTPS outside loopback');
const operator=config.users.find(u=>u.roles.includes('operator'));const reviewer=config.users.find(u=>u.tenant===operator?.tenant&&u.id!==operator.id&&u.roles.includes('approver'));
if(!operator||!reviewer)throw new Error('Independent operator and reviewer identities required');
async function api(path,identity=operator,data,key){const r=await fetch(new URL('/api/'+path,base),{method:data?'POST':'GET',headers:{authorization:'Bearer '+identity.token,...(data?{'content-type':'application/json','idempotency-key':key??'approval-request'}:{})},body:data?JSON.stringify(data):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;}
const stamp=Date.now();const catalog=await api('workflow-catalog');const cases=process.argv.includes('--failure-cases')?[['demo-held','HELD'],['demo-rejected','COMPENSATED'],['demo-timeout','COMPLETED']]:[[process.env.CG_RESOURCE??'demo-1','COMPLETED']];
for(const b of catalog.bindings){
  for(const [resource,expected]of cases){
    const externalId=`smoke-${stamp}-${b.id}-${resource}`;let c=await api('workflows',operator,{binding:b.id,resource,source:'manual',externalId,summary:catalog.packs.find(p=>p.id===b.pack).objective},externalId);
    console.log(`Submitted ${b.pack} / ${resource}: ${c.id}`);const deadline=Date.now()+600000;
    while(!['COMPLETED','COMPENSATED','HELD','CANCELLED'].includes(c.state)&&Date.now()<deadline){
      if(c.state==='REVIEW')await api(`workflows/${c.id}/approve`,reviewer,{});
      await new Promise(r=>setTimeout(r,500));c=await api('workflows/'+c.id);
    }
    if(c.state!==expected)throw new Error(`${b.pack}/${resource}: expected ${expected}, received ${c.state}: ${c.reason}`);
    if(expected==='COMPLETED'&&!c.verification?.checks.every(x=>x.passed))throw new Error('Completion lacks verified postconditions');
    console.log(`PASS ${b.pack} / ${resource}: ${c.state}; ${c.receipts.length} action receipts; ${c.compensations.length} compensations`);
  }
}
