# Operations, resilience and cost

> Future architecture reference. The implemented v0.1 behavior, diagrams, installation and usage are documented in the [main README](../README.md). Statements below describe target architecture unless explicitly stated otherwise.


[Documentation index](../README.md)

## Operating principles

The proposed platform is outside the application request path. Its failure should delay change decisions, not interrupt customer transactions. Keep a reviewed manual release and incident process available. Manual bypass must be separately authorized and recorded; it must not silently pretend platform checks succeeded.

## Failure runbooks

| Failure | Immediate behavior | Recovery check |
|---|---|---|
| Model unavailable | Stop bounded retries; preserve evidence; use deterministic checks | Re-evaluate pending hypotheses before resuming |
| Telemetry stale | Hold rollout progression | Verify time synchronization, query window and data freshness |
| Workflow worker crashes | Lease expires; replacement reconciles external receipts | No duplicate writes and no stale-worker mutation |
| Policy or identity unavailable | Deny new privileged actions | Revalidate all queued authorizations |
| Audit sink unavailable | Hold production dispatch | Confirm durable audit capture before unblocking |
| Suspected credential leak | Revoke integration identity; quarantine jobs | Rotate, scope impact and approve reconnection |
| Database restore | Keep execution disabled | Reconcile target state against restored workflow records |

## Observability

Instrument queue delay, workflow age, connector freshness, source failures, authorization denials, approval age, action receipts, verification outcomes and model cost. Avoid sensitive labels, raw prompts and customer records in telemetry. Correlation IDs should link change, investigation and execution without exposing tenant identity unnecessarily.

Initial service-level targets must be negotiated with adopters and validated by load tests. No uptime or recovery target is claimed here. Track platform availability separately from investigation quality and customer-service availability.

## Backup and recovery

Back up transactional state, approved policy versions, evidence manifests and required object data. Manage encryption keys independently with tested access recovery. Periodically restore into an isolated environment. A restored approval may no longer be valid: expire pending production approvals after recovery and reconcile in-flight operations before enabling workers.

## Upgrades

Use expand-and-contract schema changes, backward-compatible event versions and a canary control cell. Test workflow replay against new worker versions. Pin model and prompt versions; rerun evaluation on upgrades. Do not let this platform authorize its own privileged upgrade without an independent release path.

## Cost controls

Estimate cost as control-plane resources plus evidence storage and retention, model input/output usage, rehearsal compute and telemetry queries. Enforce per-tenant limits and investigation budgets. Avoid copying full logs into prompts: summarize deterministically and retrieve bounded evidence. Quotas must stop new work cleanly and preserve an explicit incomplete status.

## Ownership

Assign a platform on-call owner, connector owners, security reviewer, data steward and service-specific approvers. Establish support hours and escalation channels before adoption. Operational readiness requires tested recovery and ownership, not just a deployment manifest.
