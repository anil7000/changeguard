import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Offline simulation only: approval flags are not authenticated authorization.
export function evaluate(change) {
  const result = (decision, reason) => ({ id: change?.id ?? null, decision, reason, executed: false });
  if (!change || typeof change !== 'object' || Array.isArray(change) || typeof change.id !== 'string' || !change.id.trim())
    return result('HOLD', 'Invalid change identifier');
  for (const key of ['replicas', 'poolPerReplica']) {
    if (!Number.isSafeInteger(change[key]) || change[key] <= 0) return result('HOLD', `Invalid ${key}`);
  }
  if (!Number.isSafeInteger(change.capacityBudget) || change.capacityBudget <= 0)
    return result('HOLD', 'Missing or invalid capacity evidence');
  if (change.evidenceFresh !== true) return result('HOLD', 'Evidence is stale or unverified');
  const demand = change.replicas * change.poolPerReplica;
  if (!Number.isSafeInteger(demand)) return result('HOLD', 'Demand exceeds safe numeric range');
  if (demand > change.capacityBudget) return result('BLOCK', 'Proposed connection demand exceeds allocated capacity');
  if (change.rollbackTested !== true) return result('HOLD', 'Recovery prerequisite is not verified');
  if (!change.approval) return result('REVIEW', 'Independent approval required');
  if (change.approval.actionId !== change.id || change.approval.independent !== true || change.approval.valid !== true)
    return result('HOLD', 'Approval is mismatched, invalid or not independent');
  return result('ELIGIBLE', 'Simulation checks passed; no execution is authorized');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const path = process.argv[2] ?? new URL('./scenarios.json', import.meta.url);
    const input = JSON.parse(readFileSync(path, 'utf8'));
    console.log(JSON.stringify((Array.isArray(input) ? input : [input]).map(evaluate), null, 2));
  } catch (error) {
    console.error(`Cannot evaluate fixture: ${error.message}`);
    process.exitCode = 1;
  }
}
