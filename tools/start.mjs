import { existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
if(!existsSync(process.env.CG_CONFIG??'data/config.json')){
  const result=spawnSync(process.execPath,['tools/init.mjs'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
}
const child=spawn(process.execPath,['src/server.mjs'],{stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??0;});
