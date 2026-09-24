import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
function setup(t){
  const dir=mkdtempSync(join(tmpdir(),'cg-config-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'config.json');const env={...process.env,CG_CONFIG:path};
  const run=(script,...args)=>spawnSync(process.execPath,[resolve(root,'tools',script),...args],{env,encoding:'utf8',cwd:root});
  assert.equal(run('init.mjs').status,0);return {dir,path,run,read:()=>JSON.parse(readFileSync(path,'utf8'))};
}
test('identity tooling adds least-privilege ingestion identity and rotates only the requested token',t=>{
  const {run,read,dir}=setup(t);const before=read();
  const added=run('access.mjs','add','--id','monitor','--tenant','local','--roles','collector');assert.equal(added.status,0,added.stderr);
  const after=read();assert.deepEqual(after.users.slice(0,2),before.users);assert.deepEqual(after.users[2].roles,['collector']);assert.ok(!added.stdout.includes(after.users[2].token));
  assert.equal(run('access.mjs','rotate','--id','monitor','--tenant','local').status,0);assert.notEqual(read().users[2].token,after.users[2].token);
  assert.ok(readdirSync(dir).some(n=>n.includes('.backup-')));
});
test('invalid access changes preserve the original configuration',t=>{
  const {run,read}=setup(t);const before=read();
  assert.notEqual(run('access.mjs','roles','--id','engineer','--tenant','local','--roles','superuser').status,0);assert.deepEqual(read(),before);
  assert.notEqual(run('access.mjs','remove','--id','engineer','--tenant','local').status,0);assert.deepEqual(read(),before);
});
test('diagnostic client refuses to send a workspace token over remote cleartext HTTP',t=>{
  const {path}=setup(t);
  const result=spawnSync(process.execPath,[resolve(root,'tools/doctor.mjs')],{cwd:root,env:{...process.env,CG_CONFIG:path,CG_URL:'http://metrics.example.com'},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/requires HTTPS/);
});
test('source tooling authorizes exact tenant origins without embedding secrets',t=>{
  const {run,read}=setup(t);
  assert.equal(run('sources.mjs','allow','--tenant','local','--origin','https://metrics.example.com','--secret-env','CG_SOURCE_METRICS').status,0);
  assert.deepEqual(read().connectorOrigins,[{tenant:'local',origin:'https://metrics.example.com',secretEnv:'CG_SOURCE_METRICS'}]);
  const before=read();
  assert.notEqual(run('sources.mjs','allow','--tenant','local','--origin','http://metrics.example.com','--secret-env','CG_SOURCE_METRICS').status,0);assert.deepEqual(read(),before);
  assert.equal(run('sources.mjs','remove','--tenant','local','--origin','https://metrics.example.com').status,0);assert.deepEqual(read().connectorOrigins,[]);
});
