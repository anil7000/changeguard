import { randomBytes } from 'node:crypto';
import { argumentsFor, editConfig } from './configuration.mjs';
const {command,options}=argumentsFor(process.argv.slice(2));
try{
  if(!['add','rotate','roles','remove'].includes(command))throw new Error('Usage: node tools/access.mjs add|rotate|roles|remove --id NAME --tenant TENANT [--roles viewer,operator]');
  if(!/^[a-zA-Z0-9_-]{1,60}$/.test(options.id??'')||!/^[a-zA-Z0-9_-]{1,60}$/.test(options.tenant??''))throw new Error('Safe identity and tenant IDs are required');
  editConfig(config=>{
    const existing=config.users.find(u=>u.id===options.id&&u.tenant===options.tenant);
    const roles=(options.roles??'viewer').split(',');
    if(!roles.length||!roles.every(r=>['viewer','operator','approver','admin','collector'].includes(r)))throw new Error('Unknown role');
    if(command==='add'){if(existing)throw new Error('Identity already exists');config.users.push({id:options.id,tenant:options.tenant,roles:[...new Set(roles)],token:randomBytes(32).toString('hex')});}
    else {if(!existing)throw new Error('Identity does not exist');if(command==='rotate')existing.token=randomBytes(32).toString('hex');if(command==='roles')existing.roles=[...new Set(roles)];if(command==='remove')config.users=config.users.filter(u=>u!==existing);}
    if(config.users.length<2||!config.users.some(u=>u.roles.includes('admin')))throw new Error('Keep at least two identities and one administrator');
  });
  console.log('Read newly generated tokens only from the private configuration. Distribute them through your approved secret channel.');
}catch(e){console.error(e.message);process.exitCode=1;}
