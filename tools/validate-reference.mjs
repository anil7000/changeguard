// Portable process-level acceptance test. Uses an explicitly labeled model protocol double.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
async function availableRange(){
  for(let attempt=0;attempt<20;attempt++){
    const base=18000+Math.floor(Math.random()*12000),reserved=[];let available=true;
    for(let i=0;i<9;i++){
      const server=createServer();const ok=await new Promise(resolve=>{server.once('error',()=>resolve(false));server.listen(base+i,'127.0.0.1',()=>resolve(true));});
      if(!ok){available=false;break;}reserved.push(server);
    }
    await Promise.all(reserved.map(s=>new Promise(r=>s.close(r))));if(available)return base;
  }
  throw new Error('No available local port range for reference acceptance');
}
const directory=mkdtempSync(join(tmpdir(),'changeguard-reference-'));
const env={...process.env,CG_REFERENCE_DATA:directory,CG_REFERENCE_BASE_PORT:String(await availableRange()),CG_PORT:'0',CG_HOST:'127.0.0.1'};
const child=spawn(process.execPath,['tools/reference.mjs','--protocol-test-double'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
let startup='';const exited=new Promise(resolve=>child.once('exit',resolve));
async function run(args,extra){await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{env:{...env,...extra},stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';p.stdout.on('data',s=>{output+=s;if(output.length>20000)output=output.slice(-20000);});p.stderr.on('data',s=>{output+=s;});p.once('error',reject);p.once('exit',code=>{console.log(output.trim());code===0?resolve():reject(new Error('Reference acceptance command failed: '+code));});});}
try{
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Reference startup timed out')),30000);
    child.stdout.on('data',chunk=>{startup+=chunk;const match=/Reference workspace: (http:\/\/[^\s]+)/.exec(startup);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.stderr.on('data',chunk=>{startup+=chunk;});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Reference process exited ${code}: ${startup}`));});
  });
  const extra={CG_URL:url,CG_CONFIG:join(directory,'config.json'),CG_RESOURCE:'demo-1'};
  await run(['tools/workflow-smoke.mjs'],extra);
  await run(['tools/workflow-smoke.mjs','--failure-cases'],extra);
  console.log('PASS: three complete workflows and nine recovery/escalation cases; protocol double only.');
}finally{child.kill('SIGTERM');await exited;}
