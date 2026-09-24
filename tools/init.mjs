import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
const path = resolve(process.env.CG_CONFIG ?? 'data/config.json');
const llm = { provider: 'ollama', url: 'http://127.0.0.1:11434/api/chat', model: 'qwen3:4b', embeddingUrl: 'http://127.0.0.1:11434/api/embed', embeddingModel: 'qwen3-embedding:0.6b', timeoutMs: 180000 };
if (existsSync(path) && process.argv.includes('--configure-local-model')) { const config=JSON.parse(readFileSync(path,'utf8')); if (config.llm) throw new Error('Model already configured; edit the existing configuration explicitly.'); copyFileSync(path,path+`.backup-${Date.now()}`); config.llm=llm; writeFileSync(path,JSON.stringify(config,null,2)+'\n',{mode:0o600}); console.log('Added local-model settings; credentials preserved and configuration backed up.'); }
else if (existsSync(path)) { console.error('Configuration already exists; refusing to overwrite credentials.'); process.exitCode = 1; }
else {
  mkdirSync(dirname(path), { recursive: true });
  const users = [
    { id: 'engineer', tenant: 'local', roles: ['viewer', 'operator', 'admin'] },
    { id: 'reviewer', tenant: 'local', roles: ['viewer', 'approver'] }
  ].map(user => ({ ...user, token: randomBytes(32).toString('hex') }));
  writeFileSync(path, JSON.stringify({ users, llm, workerConcurrency: 2 }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Created ${path}. Read the engineer and reviewer tokens locally; never commit this file. On Windows, restrict this file's ACL to your user. Start with node src/server.mjs.`);
}
