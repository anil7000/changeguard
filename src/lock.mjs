import { openSync, writeFileSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
export function acquireLock(path) {
  function create() { const fd = openSync(path, 'wx', 0o600); try { writeFileSync(fd, String(process.pid)); } finally { closeSync(fd); } }
  try { create(); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid runtime lock; investigate before removing it');
    try { process.kill(pid, 0); throw new Error('Another ChangeGuard process owns this database'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    unlinkSync(path); create();
  }
  let released = false;
  return () => { if (!released) { unlinkSync(path); released = true; } };
}
