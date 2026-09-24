import { createServer } from 'node:http';

// Fixed trusted fixture, not arbitrary user code. Binds only to loopback.
process.once('message', async config => {
  let server;
  try {
    const demand = config.replicas * config.poolPerReplica;
    if (![demand, config.capacityBudget].every(n => Number.isSafeInteger(n) && n > 0 && n <= 4096)) throw new Error('Invalid fixture bounds');
    let active = 0;
    server = createServer((req, res) => {
      if (req.url !== '/probe') { res.writeHead(404).end(); return; }
      // Each request models a replica asking for its configured connection allocation.
      const granted = active + config.poolPerReplica <= config.capacityBudget;
      if (granted) active += config.poolPerReplica;
      setTimeout(() => { if (granted) active -= config.poolPerReplica; res.writeHead(granted ? 200 : 503).end(granted ? 'ok' : 'capacity exhausted'); }, 30);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const start = performance.now();
    const statuses = await Promise.all(Array.from({ length: config.replicas }, async () => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/probe`, { signal: AbortSignal.timeout(4000) });
      await response.text(); return response.status;
    }));
    const result = { requests: statuses.length, passed: statuses.filter(x => x === 200).length, failed: statuses.filter(x => x !== 200).length, durationMs: Math.round(performance.now() - start), demand, capacityBudget: config.capacityBudget, adapter: 'synthetic-http-pool' };
    server.closeAllConnections(); server.close();
    process.send(result, () => process.disconnect());
  } catch { if (server) { server.closeAllConnections(); server.close(); } process.exitCode = 1; process.disconnect(); }
});
