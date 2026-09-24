import { argumentsFor, editConfig } from './configuration.mjs';
import { trustedSource } from '../src/connectors.mjs';
const {command,options}=argumentsFor(process.argv.slice(2));
try{
  if(!['allow','remove'].includes(command))throw new Error('Usage: node tools/sources.mjs allow|remove --tenant TENANT --origin https://prometheus.example.com [--secret-env CG_SOURCE_PROMETHEUS]');
  if(!/^[a-zA-Z0-9_-]{1,60}$/.test(options.tenant??''))throw new Error('Tenant is required');
  const url=new URL(options.origin);if(url.origin!==options.origin)throw new Error('Use the exact origin, without a path or trailing slash');
  editConfig(config=>{
    if(!config.users.some(u=>u.tenant===options.tenant))throw new Error('Tenant has no configured identity');
    config.connectorOrigins=(config.connectorOrigins??[]).filter(c=>!(c.tenant===options.tenant&&c.origin===url.origin));
    if(command==='allow'){config.connectorOrigins.push({tenant:options.tenant,origin:url.origin,...(options['secret-env']?{secretEnv:options['secret-env']}:{})});trustedSource(config,options.tenant,url.href);}
  });
}catch(e){console.error(e.message);process.exitCode=1;}
