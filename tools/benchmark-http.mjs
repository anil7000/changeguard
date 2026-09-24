import { readFileSync } from 'node:fs';
const config=JSON.parse(readFileSync(process.env.CG_CONFIG??'data/config.json','utf8'));
const base=process.env.CG_URL??'http://127.0.0.1:4310';const url=new URL(base);
if(url.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Benchmark is restricted to local loopback');
const samples=[];let bytes=0;
for(let i=0;i<100;i++){const start=performance.now();const r=await fetch(base+'/api/changes',{headers:{authorization:`Bearer ${config.users[0].token}`},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);bytes+=Buffer.byteLength(await r.text());samples.push(performance.now()-start);}
samples.sort((a,b)=>a-b);console.log(JSON.stringify({scope:'100 sequential authenticated GET /api/changes on local loopback; existing database; not a load test',p50Ms:samples[50],p95Ms:samples[95],responseBytesAverage:bytes/100},null,2));
