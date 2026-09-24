import { readFileSync, copyFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export function argumentsFor(argv) {
  const [command,...rest]=argv;const options={};
  for(let i=0;i<rest.length;i+=2){if(!/^--[a-z-]+$/.test(rest[i])||!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('Use --name value options');options[rest[i].slice(2)]=rest[i+1];}
  return {command,options};
}
export function editConfig(mutator) {
  const path=resolve(process.env.CG_CONFIG??'data/config.json');const config=JSON.parse(readFileSync(path,'utf8'));
  mutator(config);const backup=path+'.backup-'+randomUUID();copyFileSync(path,backup);
  const staged=path+'.'+randomUUID()+'.tmp';
  try{writeFileSync(staged,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(staged,path);}
  catch(e){try{unlinkSync(staged);}catch{}throw e;}
  console.log('Configuration updated. Restart ChangeGuard to apply. A private backup was retained beside the configuration.');
  return path;
}
