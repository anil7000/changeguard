# Delivery plan, evaluation and architecture decisions

> Future architecture reference. The implemented v0.1 behavior, diagrams, installation and usage are documented in the [main README](../README.md). Statements below describe target architecture unless explicitly stated otherwise.


[Documentation index](../README.md)

## Current delivery status

Implemented: documentation, ten architecture diagrams, synthetic fixtures, a deterministic offline evaluator and automated evaluator/document checks. Not implemented: UI, hosted API, connector services, language-model inference, retrieval, durable orchestration, signed approvals or infrastructure execution.

## Delivery gates

| Stage | Deliverable | Exit criterion |
|---|---|---|
| 0: specification | This package and offline demo | Links and fixtures validate; limitations explicit |
| 1: read-only foundation | Authenticated API, service catalog, event ingestion, evidence store | Replay deduplication, tenant isolation and source lineage pass |
| 2: investigation | Retrieval, model gateway, hypothesis workspace | Cited findings outperform baseline on held-out scenarios without access leaks |
| 3: rehearsal | Disposable workers and synthetic workloads | Resource limits, isolation and cleanup verified under failures |
| 4: controlled action | Approval broker, PR creation and execution receipts | Drift, expiry, replay and requester self-approval rejected |
| 5: supervised rollout | Target fencing, canary observation and recovery workflow | Fault injection and recovery drills pass before live adoption |
| 6: independent product | Installation artifacts, upgrades, backup and industry packs | An independent operator completes installation and recovery from documentation |

Do not assign completion dates before team capacity and environment costs are known. Progress is measured by working exit criteria, not page count or agent count.

## Evaluation design

Build a reproducible synthetic service environment with seeded connection exhaustion, retry storms, stale configuration, dependency latency, incompatible schema changes, missing telemetry, malicious runbooks and unauthorized tenant access. Ground truth comes from fixture construction, not model self-evaluation.

Compare three conditions: conventional CI checks, deterministic change rules and the proposed agentic workflow. Keep workloads and observability equal. Measure failure detection recall, false-block rate, correct evidence citations, time to a verified finding, unsafe-action attempts blocked and cost per investigation. Report sample size, failure families and uncertainty; do not translate a lab result into an unqualified production MTTR claim.

Separate investigation quality from execution safety. A correct hypothesis does not excuse an unauthorized action. Include abstention cases and missing evidence. Hold out incident families and vary irrelevant recent changes to test whether the system merely blames the newest deployment.

## Architecture decision records

| ADR | Decision | Trade-off and revisit trigger |
|---|---|---|
| 001 | Event/workspace interface rather than chat-first | More UI work; preserves structured evidence and approvals |
| 002 | Deterministic authority outside the model | More explicit contracts; prevents model text becoming permission |
| 003 | Modular control plane plus isolated workers | Simpler early operations; split services on measured needs |
| 004 | Relational dependency graph initially | Limited complex traversal; revisit after profiling |
| 005 | Synthetic operational data by default | Lower realism; add reviewed data only when necessary |
| 006 | Single-region write authority per target | Less failover flexibility; avoids concurrent mutation ambiguity |
| 007 | No mandatory hosted model provider | More evaluation work; enables private and disconnected use |

## Release checklist

Each executable release needs an SBOM, pinned dependency manifest, license review, migration notes, regression evaluation, threat-model update, rollback or recovery instructions and an accurate implemented-versus-planned feature list. Select the project's license before distributing it as open source.
