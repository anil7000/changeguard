import { fork } from 'node:child_process';
export function experiment(config) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL('./experiment-child.mjs', import.meta.url), [], {
      env: {}, execArgv: ['--max-old-space-size=64'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true
    });
    let result; let settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('Rehearsal timed out')); }, 7000);
    function finish(error) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
    child.once('error', finish);
    child.on('message', message => { result = message; });
    child.once('exit', code => finish(code === 0 && result ? null : new Error('Rehearsal failed')));
    child.send({ replicas: config.replicas, poolPerReplica: config.poolPerReplica, capacityBudget: config.capacityBudget });
  });
}
