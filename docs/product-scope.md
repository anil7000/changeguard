# Product contract

## Objective

Resolve cross-system operational failures across an enterprise, from discovering the problem through authorized corrective action to verifying the business outcome, with minimal manual coordination.

The shared problem is that a process spans several systems and teams, but no single system has enough context or authority to complete recovery. People gather evidence, interpret procedures, chase approvals and coordinate corrections manually.

## Scope

- Business operations: failed orders, payment discrepancies, inventory inconsistencies and supplier handoff failures.
- Technology operations: failed deployments, infrastructure faults, broken integrations and data pipelines.
- Access and governance: incomplete onboarding, inconsistent permissions and policy violations.

These share multiple entry points, an explicit process/dependency graph, tenant-isolated RAG, agent investigation, durable workflows, policy-controlled actions, approvals, recovery and independent outcome verification. Industry-specific connectors, procedures and acceptance rules extend that foundation. Protocol compatibility still requires configuration; arbitrary systems are not automatically integrated.

## Acceptance boundary

Three executable reference workflows must use the same engine: business-transaction recovery, technology-incident recovery and employee-access reconciliation. Each must demonstrate success, safe handling of partial failure, and human escalation. The local reference systems are deliberately isolated simulations, not evidence of adoption or production integration.

LLM and embedding-backed RAG are required to reach an execution decision. Models may recommend an allowlisted plan or escalate; they never select network destinations, credentials, permissions or arbitrary commands. Deterministic policy has final authority.

The release must include an operations UI, replay-safe event ingress, durable action intent/receipts, independent approvals, scoped adapters, compensation, postcondition checks, restart recovery, audit records, deployment instructions, a documented adapter contract and failure-injection tests. Existing telemetry investigation remains a supporting module, not the product's identity.

## Non-claims

No universal cloud connector, compliance certification, high availability, exactly-once distributed delivery, guaranteed diagnosis, arbitrary autonomous repair or performance SLA is implied. Production adoption requires external identity/network controls, adapter qualification, domain-specific policy and operational acceptance. Gaps are tracked in the README rather than hidden behind an enterprise-grade label.
