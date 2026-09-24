// Reproducible control-plane microbenchmark, not a model or production-load benchmark.
import { Store } from '../src/store.mjs';
import { Engine } from '../src/engine.mjs';
import { platform, arch, cpus } from 'node:os';
const store=new Store(':memory:'); const engine=new Engine(store,{users:[]});
store.transaction(()=>{for(let i=0;i<20000;i++)store.insert({id:`history-${i}`,tenant:'benchmark',state:'COMPLETED',title:'Representative completed record',payload:'x'.repeat(1000)},`key-${i}`,'hash');});
const measure=async(fn,n=1000)=>{const samples=[];for(let i=0;i<n;i++){const t=performance.now();await fn();samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);return {iterations:n,p50Ms:Number(samples[Math.floor(n*.5)].toFixed(4)),p95Ms:Number(samples[Math.floor(n*.95)].toFixed(4))};};
const indexed=await measure(()=>engine.tick());
const legacy=await measure(()=>{store.all().find(c=>c.state==='VERIFYING');store.all().find(c=>c.state==='QUEUED');},25);
const quota=await measure(()=>store.pendingCount('benchmark'));
console.log(JSON.stringify({scope:'in-memory SQLite; 20,000 completed records; sequential idle polling; excludes disk, HTTP and inference',runtime:process.version,os:platform(),arch:arch(),cpu:cpus()[0].model,indexedIdlePoll:indexed,legacyFullScan:legacy,pendingCount:quota},null,2));
await engine.stop();store.close();
