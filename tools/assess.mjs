import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { incidentBundle } from '../examples/incident-bundle.mjs';
const config = JSON.parse(readFileSync(process.env.CG_CONFIG ?? 'data/config.json','utf8'));
const user = config.users.find(u => u.roles.includes('operator'));
if (!user) throw new Error('Operator identity required');
const base = process.env.CG_URL ?? 'http://127.0.0.1:4310';
const url = new URL(base); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Remote endpoints require HTTPS');
async function api(path,body) { const r = await fetch(base+path,{ method:body?'POST':'GET',headers:{authorization:`Bearer ${user.token}`,'content-type':'application/json','idempotency-key':randomUUID()},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000) }); const data=await r.json(); if (!r.ok) throw new Error(`${r.status}: ${data.error}`); return data; }
const bundle = process.argv[2] ? JSON.parse(readFileSync(process.argv[2],'utf8')) : incidentBundle();
const started=performance.now();
const c=await api('/api/changes',{kind:'assessment',title:process.env.CG_QUESTION??'Assess recent deployment risk and dependency failures',environment:process.env.CG_ENVIRONMENT??'default',bundle});
console.error(`Investigation ${c.id} queued; waiting for mandatory AI and RAG.`);
let previous='';
for (let i=0;i<600;i++) { const result=await api(`/api/changes/${c.id}`); const stage=result.progress??result.state; if(stage!==previous){console.error(stage);previous=stage;} if (['ANALYZED','HELD','CANCELLED'].includes(result.state)) { console.log(JSON.stringify({...result,clientElapsedMs:Math.round(performance.now()-started)},null,2)); if(result.state!=='ANALYZED')process.exitCode=1; break; } await new Promise(r=>setTimeout(r,1500)); if(i===599)throw new Error('Investigation timed out after 15 minutes; inspect persisted job before resubmitting'); }
