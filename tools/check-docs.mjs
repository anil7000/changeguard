import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['README.md', 'VERIFICATION.md', ...readdirSync(resolve(root, 'examples/runbooks')).filter(x => x.endsWith('.md')).map(x => `examples/runbooks/${x}`), ...readdirSync(resolve(root, 'docs')).filter(x => x.endsWith('.md')).map(x => `docs/${x}`)];
let diagrams = 0;
for (const file of files) {
  const content = readFileSync(resolve(root, file), 'utf8');
  if ((content.match(/^```/gm) ?? []).length % 2) throw new Error(`Unbalanced fences: ${file}`);
  if (/[\u200B-\u200D\uFEFF\u00AD]/u.test(content)) throw new Error(`Hidden character: ${file}`);
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^https?:/.test(link) || link.startsWith('#')) continue;
    if (!existsSync(resolve(root, dirname(file), link.split('#')[0]))) throw new Error(`Broken link in ${file}: ${link}`);
  }
  diagrams += (content.match(/^```mermaid/gm) ?? []).length;
}
if (diagrams !== 6) throw new Error(`Expected 6 README diagrams, found ${diagrams}`);
console.log(`PASS: ${files.length} Markdown pages; local links, fences, hidden characters; ${diagrams} Mermaid blocks. Diagram rendering is a separate check.`);
