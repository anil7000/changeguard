import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const config = JSON.parse(readFileSync(process.env.CG_CONFIG ?? 'data/config.json', 'utf8'));
const engineer = config.users.find(u => u.roles.includes('operator'));
const reviewer = config.users.find(u => u.tenant === engineer?.tenant && u.id !== engineer.id && u.roles.includes('approver'));
if (!engineer || !reviewer) throw new Error('Smoke test requires an operator and independent reviewer in the same tenant');
const base = process.env.CG_URL ?? 'http://127.0.0.1:4310';
const url = new URL(base);
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote smoke endpoint must use HTTPS');
async function request(path, user, method = 'GET', data) {
  const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
  const body = await response.json(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error}`); return body;
}
async function wait(id, desired) {
  for (let i = 0; i < 300; i++) {
    const c = await request(`/api/changes/${id}`, engineer);
    if (c.state === desired) return c;
    if (['BLOCKED', 'HELD', 'ROLLED_BACK', 'CANCELLED'].includes(c.state)) throw new Error(`Unexpected ${c.state}: ${c.reason}`);
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`Timed out waiting for ${desired}`);
}
const change = await request('/api/changes', engineer, 'POST', { title: 'Synthetic pool workflow validation', environment: 'synthetic-lab', replicas: 3, poolPerReplica: 10, capacityBudget: 120, evidenceFresh: true, rollbackTested: true });
await wait(change.id, 'REVIEW');
await request(`/api/changes/${change.id}/approve`, reviewer, 'POST');
await request(`/api/changes/${change.id}/execute`, engineer, 'POST');
const complete = await wait(change.id, 'COMPLETED');
console.log(JSON.stringify({ status: 'PASS', changeId: change.id, state: complete.state, rehearsal: complete.rehearsal, verification: complete.verification, revision: complete.receipt.revision }, null, 2));
