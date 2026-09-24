// Protocol-level test double, never imported by production code.
import { createServer } from 'node:http';
export async function modelFixture(t, overrides = {}) {
  const calls = [];
  const server = createServer(async (req,res) => {
    const parts = []; for await (const p of req) parts.push(p);
    const data = JSON.parse(Buffer.concat(parts)); calls.push(data);
    res.setHeader('content-type','application/json');
    if (req.url.includes('embed')) { const vectors = data.input.map(s => [1, s.includes('pool') ? 1 : 0.25, 0.5]); return res.end(JSON.stringify({ embeddings: vectors, data: vectors.map((embedding,index) => ({ index,embedding })) })); }
    const system = data.messages[0].content; const input = JSON.parse(data.messages[1].content); let output;
    if (system.includes('Plan a bounded')) output = { reason: 'Inspect time-correlated changes and recovery readiness.', tools: ['change_correlation','recovery_readiness'] };
    else if (system.includes('skeptical evidence reviewer')) output = { checks: input.hypotheses.map((h,index) => ({ index,supported: true,reason: 'consistent-with-provided-evidence' })) };
    else { const runbooks=input.evidence.filter(e=>!e.documentId.startsWith('tool:')).slice(0,1).map(e=>e.documentId); output = { summary: 'Inspect dependency capacity and recent deployment evidence.', hypotheses: [system.includes('Synthesize') ? {sourceService:'database',affectedServices:['checkout'],mechanism:'Connection pressure may propagate to its consumer.',verification:'Compare connection telemetry before and after the deployment.',observations:['tool:telemetry_compare'],runbooks} : {claim:'Observed pressure warrants checking capacity and recent changes.',citations:runbooks}] }; }
    output = overrides.reply ? overrides.reply({ system,input,output }) : output;
    res.end(JSON.stringify({ done: true, message: { content: JSON.stringify(output) }, choices: [{ message: { content: JSON.stringify(output) } }] }));
  });
  await new Promise(r => server.listen(overrides.port??0,overrides.host??'127.0.0.1',r));
  const close = () => new Promise(r => server.close(r)); if (t) t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { calls, close, llm: { provider: 'ollama', url: base+'/api/chat', model: 'protocol-test-double', embeddingUrl: base+'/api/embed', embeddingModel: 'test-embedding' } };
}
