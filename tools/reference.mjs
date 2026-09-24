import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { referenceService } from '../demo/reference-service.mjs';
import { packs } from '../src/workflow-packs.mjs';
import { start } from '../src/server.mjs';

const directory=resolve(process.env.CG_REFERENCE_DATA??'data/reference');mkdirSync(directory,{recursive:true});
const configPath=resolve(directory,'config.json');const secretPath=resolve(directory,'adapter-credentials.json');
const basePort=Number(process.env.CG_REFERENCE_BASE_PORT??4320);const appPort=Number(process.env.CG_PORT??4315);
if(!Number.isInteger(basePort)||basePort<1024||basePort>65527||!Number.isInteger(appPort)||appPort<0||appPort>65535||appPort>=basePort&&appPort<=basePort+8)throw new Error('Choose a valid UI port and a separate nine-port adapter range (1024-65535)');
const base=new URL(process.env.CG_MODEL_BASE??'http://127.0.0.1:11434').origin;
const definitions=Object.entries(packs).flatMap(([pack,p])=>p.roles.map(role=>({pack,role})));
if(!existsSync(configPath)){
  if(existsSync(secretPath))throw new Error('Orphaned reference credentials exist; preserve and review before initialization');
  const users=[{id:'engineer',tenant:'reference',roles:['viewer','operator','admin']},{id:'reviewer',tenant:'reference',roles:['viewer','approver']}].map(u=>({...u,token:randomBytes(32).toString('hex')}));
  const secrets=Object.fromEntries(definitions.map((_,i)=>['CG_SOURCE_REFERENCE_'+i,randomBytes(32).toString('hex')]));
  const connectorOrigins=definitions.map((_,i)=>({tenant:'reference',origin:`http://127.0.0.1:${basePort+i}`,secretEnv:'CG_SOURCE_REFERENCE_'+i}));
  const workflowBindings=Object.entries(packs).map(([pack,p])=>({id:pack,tenant:'reference',pack,environment:'reference-lab',enabled:true,mode:pack==='access-reconciliation'?'approval':'automatic',resourcePrefix:'demo-',procedureIds:[pack],adapters:Object.fromEntries(p.roles.map(role=>[role,{endpoint:connectorOrigins[definitions.findIndex(d=>d.pack===pack&&d.role===role)].origin}]))}));
  writeFileSync(secretPath,JSON.stringify(secrets,null,2)+'\n',{mode:0o600,flag:'wx'});
  writeFileSync(configPath,JSON.stringify({users,workflowBindings,connectorOrigins,llm:{provider:'ollama',url:base+'/api/chat',model:'qwen3:4b',embeddingUrl:base+'/api/embed',embeddingModel:'qwen3-embedding:0.6b',timeoutMs:240000,trustedLocalOrigin:base}},null,2)+'\n',{mode:0o600,flag:'wx'});
}
const config=JSON.parse(readFileSync(configPath,'utf8'));const secrets=JSON.parse(readFileSync(secretPath,'utf8'));for(const [key,value]of Object.entries(secrets))process.env[key]=value;
for(const [index,{pack,role}]of definitions.entries())if(config.workflowBindings.find(b=>b.id===pack)?.adapters[role]?.endpoint!==`http://127.0.0.1:${basePort+index}`)throw new Error('Adapter ports differ from saved reference configuration; restore the original base port or choose a new CG_REFERENCE_DATA directory');
if(process.env.CG_MODEL_BASE)config.llm={...config.llm,url:base+'/api/chat',embeddingUrl:base+'/api/embed',trustedLocalOrigin:base};
let fakeModel;const services=[];let app;
try{
  if(process.argv.includes('--protocol-test-double')){const {modelFixture}=await import('../test/model-fixture.mjs');fakeModel=await modelFixture(null,{reply:({system,input})=>system.startsWith('Review the proposed cross-system')?{checks:input.reviewRoles.map(role=>({role,allowed:true,reason:'Protocol fixture review; not real AI reasoning.'}))}:{summary:'Protocol fixture proposal for interface testing only.',recommendation:'execute',citations:[input.evidence[0].documentId]}});config.llm=fakeModel.llm;console.log('PROTOCOL TEST DOUBLE: this run does not validate real-model reasoning.');}
  for(const [index,{pack,role}]of definitions.entries()){
    const p=packs[pack];const initial=p.guards[role]??p.steps.find(s=>s.role===role).from;
    const values=Object.fromEntries(Array.from({length:20},(_,i)=>['demo-'+(i+1),initial]));
    values['demo-held']=p.guards[role]?{...initial,status:'unknown'}:initial;values['demo-rejected']=initial;values['demo-timeout']=initial;
    let dropped=false;
    const service=await referenceService({path:resolve(directory,`${pack}-${role}.sqlite`),token:secrets['CG_SOURCE_REFERENCE_'+index],role,transitions:p.steps.filter(s=>s.role===role),initial:values,port:basePort+index,fault:{beforeApply:intent=>intent.resource==='demo-rejected' && intent.kind==='apply' && role===p.steps[1].role?409:false,dropResponse:intent=>{if(intent.resource==='demo-timeout' && intent.kind==='apply' && role===p.steps[0].role && !dropped){dropped=true;return true;}return false;}}});services.push(service);
  }
  app=await start({config,dbPath:resolve(directory,'control-plane.sqlite'),port:appPort,host:process.env.CG_HOST??'127.0.0.1'});
  for(const [id,p]of Object.entries(packs))if(!app.store.doc('reference',id))app.store.putDoc('reference',{id,title:p.title,source:'Bundled reference-lab procedure; qualify before production',text:p.procedure,expiresAt:new Date(Date.now()+30*86400000).toISOString()});
  console.log(`Reference workspace: ${app.url}\nCredentials: ${configPath}\nNine isolated adapter services: ports ${basePort}-${basePort+8}\nResources: demo-1 through demo-20, demo-held, demo-rejected, demo-timeout\nUse the engineer token; access reconciliation requires the separate reviewer token.\nThese are reference systems. No production systems are connected.`);
  let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();for(const s of services)await s.close();await fakeModel?.close();};
  process.on('SIGINT',()=>close().then(()=>process.exit(0)));process.on('SIGTERM',()=>close().then(()=>process.exit(0)));
}catch(e){await app?.close();for(const s of services)await s.close();await fakeModel?.close();console.error(e.message);process.exitCode=1;}
