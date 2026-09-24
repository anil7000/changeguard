import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { retrieve, propose } from '../src/intelligence.mjs';

const doc = { id: 'r1', title: 'Database pool', source: 'local', digest: 'abc', text: 'Database connection pool capacity must be tested before a rollout.', expiresAt: '2099-01-01T00:00:00Z' };
test('retrieval cites relevant fresh chunks and excludes expired evidence', () => {
  assert.equal(retrieve([doc], 'database pool')[0].documentId, 'r1');
  assert.equal(retrieve([{ ...doc, expiresAt: '2000-01-01' }], 'database pool').length, 0);
  assert.equal(retrieve([doc], 'unrelatedword').length, 0);
});
test('configured model receives retrieved evidence and returns validated citations', async t => {
  let captured;
  const server = createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); captured = JSON.parse(Buffer.concat(chunks)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Inspect pool pressure.', hypotheses: [{ claim: 'Capacity could be exceeded.', citations: ['r1'] }] }) } }] })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const result = await propose({ title: 'Pool change' }, retrieve([doc], 'database'), { llm: { url: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, model: 'test-double' } });
  assert.equal(result.provider, 'configured-model'); assert.ok(captured.messages[1].content.includes('r1'));
});
test('fabricated model citations cause deterministic fallback', async t => {
  const server = createServer((req, res) => res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Claim', hypotheses: [{ claim: 'Unknown evidence', citations: ['fake'] }] }) } }] })));
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const result = await propose({}, [doc], { llm: { url: `http://127.0.0.1:${server.address().port}/v1/chat/completions` } }); assert.equal(result.provider, 'deterministic'); assert.ok(result.warning);
});
test('remote unencrypted model endpoints are rejected', async () => {
  await assert.rejects(propose({}, [], { llm: { url: 'http://example.com/api' } }), /HTTPS/);
});
