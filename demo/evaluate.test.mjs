import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate } from './evaluate.mjs';

const base = { id: 'x', replicas: 2, poolPerReplica: 10, capacityBudget: 40, evidenceFresh: true, rollbackTested: true };
const cases = [
  ['missing input', null, 'HOLD'],
  ['invalid ID', { ...base, id: '' }, 'HOLD'],
  ['string replica count', { ...base, replicas: '2' }, 'HOLD'],
  ['negative pool', { ...base, poolPerReplica: -1 }, 'HOLD'],
  ['fractional count', { ...base, replicas: 1.5 }, 'HOLD'],
  ['missing capacity', { ...base, capacityBudget: null }, 'HOLD'],
  ['zero capacity', { ...base, capacityBudget: 0 }, 'HOLD'],
  ['stale evidence', { ...base, evidenceFresh: false }, 'HOLD'],
  ['truthy evidence rejected', { ...base, evidenceFresh: 'true' }, 'HOLD'],
  ['overflow', { ...base, replicas: Number.MAX_SAFE_INTEGER }, 'HOLD'],
  ['over capacity', { ...base, capacityBudget: 19 }, 'BLOCK'],
  ['untested recovery', { ...base, rollbackTested: false }, 'HOLD'],
  ['approval missing', base, 'REVIEW'],
  ['capacity boundary', { ...base, capacityBudget: 20 }, 'REVIEW'],
  ['wrong action', { ...base, approval: { actionId: 'y', independent: true, valid: true } }, 'HOLD'],
  ['self approval', { ...base, approval: { actionId: 'x', independent: false, valid: true } }, 'HOLD'],
  ['invalid approval', { ...base, approval: { actionId: 'x', independent: true, valid: false } }, 'HOLD'],
  ['eligible simulation', { ...base, approval: { actionId: 'x', independent: true, valid: true } }, 'ELIGIBLE'],
];
for (const [name, input, expected] of cases) test(name, () => {
  const before = JSON.stringify(input);
  const result = evaluate(input);
  assert.equal(result.decision, expected);
  assert.equal(result.executed, false);
  assert.equal(JSON.stringify(input), before);
});
test('documented fixture outcomes', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./scenarios.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixtures.map(x => evaluate(x).decision), ['BLOCK', 'HOLD', 'REVIEW', 'ELIGIBLE']);
});
