import { digest, now, uid } from './store.mjs';
import { retrieve, propose } from './intelligence.mjs';
import { experiment } from './experiment.mjs';

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new HttpError(status, message); };
export const POLICY = 'pool-safety-v1';
export const sectorList = ['healthcare', 'retail', 'finance', 'saas', 'manufacturing', 'telecom', 'public-services', 'media'];
const bounded = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max;

export function validateChange(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Expected a change object');
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 180) fail(400, 'Title must contain 1-180 characters');
  if (!sectorList.includes(body.sector)) fail(400, 'Unsupported industry');
  if (!bounded(body.replicas, 32) || !bounded(body.poolPerReplica, 128)) fail(400, 'Replicas must be 1-32; pool must be 1-128');
  if (body.capacityBudget !== null && !bounded(body.capacityBudget, 4096)) fail(400, 'Capacity must be null or 1-4096');
  if (typeof body.evidenceFresh !== 'boolean' || typeof body.rollbackTested !== 'boolean') fail(400, 'Evidence and recovery flags must be booleans');
  return { title: body.title.trim(), sector: body.sector, replicas: body.replicas, poolPerReplica: body.poolPerReplica, capacityBudget: body.capacityBudget, evidenceFresh: body.evidenceFresh, rollbackTested: body.rollbackTested };
}

export class Engine {
  constructor(store, config) { this.store = store; this.config = config; this.busy = false; this.stopped = false; this.active = Promise.resolve(); }
  seed(tenants) {
    for (const tenant of tenants) {
      const freshTenant = !this.store.target(tenant);
      if (freshTenant) this.store.putTarget(tenant, { revision: 1, replicas: 2, poolPerReplica: 10, capacityBudget: 120, adapter: 'synthetic-http-pool' });
      if (freshTenant) {
        const text = 'Database connection pool capacity runbook. Multiply replicas by poolPerReplica. Reserve shared database capacity for other services. Rehearse concurrency before approval. Stop a rollout when connections are exhausted. Do not retry blindly. Verify recovery and independent approval.';
        this.store.putDoc(tenant, { id: 'seed-pool-runbook', title: 'Connection pool safety', source: 'bundled synthetic runbook', text, digest: digest(text), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
      }
    }
    for (const c of this.store.all()) {
      if (c.state === 'INVESTIGATING') { c.state = 'QUEUED'; this.store.save(c); }
      if (c.state === 'VERIFYING') this.store.audit(c.tenant, 'worker', 'verification-resume', { changeId: c.id });
    }
  }
  submit(user, body, key) {
    const data = validateChange(body); const hash = digest(data);
    if (!key || !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) fail(400, 'Idempotency-Key must be 8-100 safe characters');
    const existing = this.store.byKey(user.tenant, key);
    if (existing) { if (existing.request_hash !== hash) fail(409, 'Idempotency key reused with different content'); return this.store.change(user.tenant, existing.id); }
    if (this.store.list(user.tenant).filter(c => ['QUEUED', 'INVESTIGATING', 'EXECUTE_QUEUED', 'VERIFYING'].includes(c.state)).length >= 20) fail(429, 'Tenant queue limit reached');
    const c = { ...data, id: uid(), tenant: user.tenant, requester: user.id, state: 'QUEUED', createdAt: now(), updatedAt: now(), policyVersion: POLICY };
    this.store.transaction(() => { this.store.insert(c, key, hash); this.store.audit(user.tenant, user.id, 'change-submitted', { changeId: c.id }); });
    return c;
  }
  current(user, id) { const c = this.store.change(user.tenant, id); if (!c) fail(404, 'Change not found'); return c; }
  evidenceValid(c) { return c.evidence?.length > 0 && c.evidence.every(e => { const d = this.store.doc(c.tenant, e.documentId); return d && d.digest === e.digest && Date.parse(d.expiresAt) > Date.now(); }); }
  approve(user, id) {
    const c = this.current(user, id);
    if (c.state !== 'REVIEW') fail(409, 'Change is not awaiting approval');
    if (user.id === c.requester) fail(403, 'Requester cannot approve their own change');
    if (!this.evidenceValid(c)) fail(409, 'Evidence has expired, changed or been removed; resubmit');
    if (this.store.target(c.tenant).revision !== c.action.expectedRevision) fail(409, 'Target changed; resubmit for investigation');
    c.approval = { approver: user.id, actionDigest: digest(c.action), expiresAt: new Date(Date.now() + 15 * 60000).toISOString() };
    c.state = 'APPROVED'; c.reason = 'Independent approval recorded; operator may request bounded execution.';
    this.store.transaction(() => { this.store.save(c); this.store.audit(c.tenant, user.id, 'approved', { changeId: c.id, actionDigest: c.approval.actionDigest }); });
    return c;
  }
  execute(user, id) {
    const c = this.current(user, id);
    if (['EXECUTE_QUEUED', 'VERIFYING', 'COMPLETED', 'ROLLED_BACK'].includes(c.state)) return c;
    if (c.state !== 'APPROVED') fail(409, 'Independent approval required');
    this.preflight(c);
    c.state = 'EXECUTE_QUEUED'; c.reason = 'Execution queued; safety checks will run again before application.';
    this.store.transaction(() => { this.store.save(c); this.store.audit(c.tenant, user.id, 'execution-requested', { changeId: c.id }); });
    return c;
  }
  preflight(c) {
    if (!c.approval || c.approval.approver === c.requester || Date.parse(c.approval.expiresAt) <= Date.now() || c.approval.actionDigest !== digest(c.action)) fail(409, 'Approval invalid or expired');
    if (!this.config.users.some(u => u.tenant === c.tenant && u.id === c.approval.approver && u.roles.includes('approver'))) fail(409, 'Approver is no longer authorized');
    if (c.policyVersion !== POLICY || !this.evidenceValid(c)) fail(409, 'Policy or evidence changed; resubmit');
    if (Date.now() - Date.parse(c.investigatedAt) > 30 * 60000) fail(409, 'Investigation expired; resubmit');
    if (this.store.target(c.tenant).revision !== c.action.expectedRevision) fail(409, 'Target revision drift; resubmit');
  }
  cancel(user, id) {
    const c = this.current(user, id);
    if (!['QUEUED', 'REVIEW', 'APPROVED', 'EXECUTE_QUEUED', 'HELD', 'BLOCKED'].includes(c.state)) fail(409, 'Cannot cancel in-flight or completed work');
    c.state = 'CANCELLED'; this.store.transaction(() => { this.store.save(c); this.store.audit(c.tenant, user.id, 'cancelled', { changeId: id }); }); return c;
  }
  async investigate(c) {
    c.state = 'INVESTIGATING'; this.store.save(c);
    c.evidence = retrieve(this.store.docs(c.tenant), `${c.title} ${c.sector} database connection pool capacity recovery`);
    c.analysis = await propose(c, c.evidence, this.config);
    c.investigatedAt = now();
    const target = this.store.target(c.tenant);
    c.action = { operation: 'update-synthetic-pool', expectedRevision: target.revision, replicas: c.replicas, poolPerReplica: c.poolPerReplica, capacityBudget: c.capacityBudget, policy: POLICY, evidenceDigest: digest(c.evidence.map(e => [e.documentId, e.digest])) };
    if (!c.capacityBudget || !c.evidenceFresh || !c.rollbackTested || !this.evidenceValid(c)) { c.state = 'HELD'; c.reason = 'Missing capacity, fresh runbook evidence or verified recovery prerequisite'; }
    else {
      c.rehearsal = await experiment(c);
      if (c.replicas * c.poolPerReplica > c.capacityBudget || c.rehearsal.failed) { c.state = 'BLOCKED'; c.reason = 'Allocated dependency budget exceeded or rehearsal failed'; }
      else { c.state = 'REVIEW'; c.reason = 'Rehearsal passed. Independent approval is required.'; }
    }
    this.store.transaction(() => { this.store.save(c); this.store.audit(c.tenant, 'worker', 'investigated', { changeId: c.id, state: c.state, citations: c.evidence.map(e => e.documentId) }); });
  }
  async apply(c) {
    this.preflight(c);
    const before = this.store.target(c.tenant);
    c.receipt = { operationId: c.id, before, revision: before.revision + 1, appliedAt: now() };
    c.state = 'VERIFYING'; c.reason = 'Synthetic configuration applied; verifying postconditions.';
    this.store.transaction(() => {
      this.store.putTarget(c.tenant, { revision: c.receipt.revision, replicas: c.action.replicas, poolPerReplica: c.action.poolPerReplica, capacityBudget: c.action.capacityBudget, adapter: 'synthetic-http-pool', lastOperation: c.id });
      this.store.save(c); this.store.audit(c.tenant, 'worker', 'target-applied', { changeId: c.id, revision: c.receipt.revision });
    });
    await this.verify(c);
  }
  async verify(c) {
    const target = this.store.target(c.tenant);
    if (target.lastOperation !== c.id || target.revision !== c.receipt.revision) throw new Error('Target drift during verification');
    try {
      c.verification = await experiment(target);
      if (c.verification.failed) throw new Error('Postcondition failed');
      c.state = 'COMPLETED'; c.reason = 'Synthetic target updated and independently probed; no production system was changed.';
      this.store.transaction(() => { this.store.save(c); this.store.audit(c.tenant, 'worker', 'verified', { changeId: c.id, passed: c.verification.passed }); });
    } catch {
      // Only this local fixture has a safe inverse. Never generalize this to production migrations.
      this.store.transaction(() => {
        const current = this.store.target(c.tenant);
        if (current.lastOperation !== c.id || current.revision !== c.receipt.revision) throw new Error('Recovery requires operator review');
        this.store.putTarget(c.tenant, { ...c.receipt.before, revision: current.revision + 1, lastOperation: `rollback:${c.id}` });
        c.state = 'ROLLED_BACK'; c.reason = 'Verification failed; local fixture configuration restored. Operator review required.';
        this.store.save(c); this.store.audit(c.tenant, 'worker', 'rolled-back', { changeId: c.id });
      });
    }
  }
  tick() {
    if (this.busy || this.stopped) return this.active;
    const c = this.store.all().find(c => c.state === 'VERIFYING') ?? this.store.all().find(c => ['QUEUED', 'EXECUTE_QUEUED'].includes(c.state));
    if (!c) return this.active;
    this.busy = true;
    this.active = (async () => {
      try { if (c.state === 'QUEUED') await this.investigate(c); else if (c.state === 'VERIFYING') await this.verify(c); else await this.apply(c); }
      catch (e) { c.state = 'HELD'; c.reason = e instanceof HttpError ? e.message : 'Worker failed safely; review evidence and resubmit.'; this.store.transaction(() => { this.store.save(c); this.store.audit(c.tenant, 'worker', 'held', { changeId: c.id, reason: c.reason }); }); }
      finally { this.busy = false; }
    })(); return this.active;
  }
  async stop() { this.stopped = true; await this.active; }
}
