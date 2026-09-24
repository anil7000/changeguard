import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
const path = resolve(process.env.CG_CONFIG ?? 'data/config.json');
if (existsSync(path)) { console.error('Configuration already exists; refusing to overwrite credentials.'); process.exitCode = 1; }
else {
  mkdirSync(dirname(path), { recursive: true });
  const users = [
    { id: 'engineer', tenant: 'local', roles: ['viewer', 'operator', 'admin'] },
    { id: 'reviewer', tenant: 'local', roles: ['viewer', 'approver'] }
  ].map(user => ({ ...user, token: randomBytes(32).toString('hex') }));
  writeFileSync(path, JSON.stringify({ users }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Created ${path}. Read the engineer and reviewer tokens locally; never commit this file. On Windows, restrict this file's ACL to your user. Start with node src/server.mjs.`);
}
