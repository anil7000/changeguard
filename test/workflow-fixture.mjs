import { randomBytes } from 'node:crypto';
import { Store, digest } from '../src/store.mjs';
import { Workflows } from '../src/workflows.mjs';
import { packs } from '../src/workflow-packs.mjs';
import { referenceService } from '../demo/reference-service.mjs';
import { modelFixture } from './model-fixture.mjs';

export async function fixture(t,{pack='transaction-recovery',customPack,mode='automatic',faults={},modelReply,dbPath=':memory:'}={}){
  const p=customPack??packs[pack];if(customPack)pack=customPack.id;const services={};const connectorOrigins=[];const adapters={};
  for(const role of p.roles){
    const token=randomBytes(32).toString('hex');const secretEnv='CG_SOURCE_TEST_'+randomBytes(8).toString('hex').toUpperCase();process.env[secretEnv]=token;
    const initial=p.guards[role]??p.steps.find(s=>s.role===role).from;
    const service=await referenceService({token,role,transitions:p.steps.filter(s=>s.role===role),initial:{'demo-1':initial},fault:faults[role]});services[role]=service;
    t.after(async()=>{await service.close();delete process.env[secretEnv];});
    connectorOrigins.push({tenant:'a',origin:service.url,secretEnv});adapters[role]={endpoint:service.url};
  }
  const model=await modelFixture(t,{reply:({system,input})=>modelReply?modelReply({system,input}):system.startsWith('Review the proposed cross-system')?{checks:input.reviewRoles.map(role=>({role,allowed:true,reason:'Transition matches supplied procedure.'}))}:{summary:'The supported recovery may restore the incomplete handoff.',recommendation:'execute',citations:[input.evidence[0].documentId]}});
  const user={id:'operator',tenant:'a',roles:['viewer','operator'],token:randomBytes(32).toString('hex')};
  const reviewer={id:'reviewer',tenant:'a',roles:['viewer','approver'],token:randomBytes(32).toString('hex')};
  const config={users:[user,reviewer],llm:model.llm,connectorOrigins,...(customPack?{workflowPacks:[customPack]}:{}),workflowBindings:[{id:'demo-binding',tenant:'a',pack,environment:'demo',mode,enabled:true,resourcePrefix:'demo-',procedureIds:['procedure'],adapters}]};
  const store=new Store(dbPath);t.after(()=>store.close());
  store.putDoc('a',{id:'procedure',title:p.title,text:p.procedure,source:'reference procedure',expiresAt:new Date(Date.now()+86400000).toISOString()});
  const workflows=new Workflows(store,config);t.after(()=>workflows.stop());
  const input={binding:'demo-binding',resource:'demo-1',source:'event',externalId:'event-1',summary:p.objective};
  const submit=(key='delivery-0001')=>workflows.submit(user,input,key);
  const mutate=(role,data)=>{const s=services[role];const r=s.read('demo-1');s.db.prepare('UPDATE resources SET body=? WHERE id=?').run(JSON.stringify({...r,version:r.version+1,data:{...r.data,...data}}),'demo-1');};
  return {workflows,store,config,user,reviewer,services,input,submit,mutate,model,digest};
}
