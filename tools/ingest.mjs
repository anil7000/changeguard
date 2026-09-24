import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
const [rootArg] = process.argv.slice(2);
if (!rootArg || !process.env.CG_TOKEN) { console.error('Usage: set CG_TOKEN to an admin token, then node tools/ingest.mjs path/to/reviewed-runbooks'); process.exitCode = 1; }
else {
  const root = resolve(rootArg); const endpoint = new URL(process.env.CG_URL ?? 'http://127.0.0.1:4310');
  if (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('Use HTTPS for a remote service');
  let count = 0;
  async function visit(dir) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || ['node_modules', 'vendor', 'data'].includes(name)) continue;
      const path = resolve(dir, name); const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { await visit(path); continue; }
      if (!['.md', '.txt'].includes(extname(path).toLowerCase()) || stat.size > 50000 || stat.size < 20) continue;
      if (++count > 50) throw new Error('Import limit: split the reviewed collection into batches of at most 50 files');
      const source = relative(root, path).replaceAll('\\', '/');
      const response = await fetch(new URL('/api/documents', endpoint), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.CG_TOKEN}` }, body: JSON.stringify({ id: createHash('sha256').update(source).digest('hex').slice(0, 24), title: source, source, text: readFileSync(path, 'utf8'), ttlHours: 168 }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Import failed (${response.status}): ${source}`);
      console.log(`Imported ${source}`);
    }
  }
  await visit(root); console.log(`Imported ${count} reviewed text files. No repository code was executed.`);
}
