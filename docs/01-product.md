# Product, requirements and scope

[Documentation index](../README.md)

## Product thesis

Reduce the uncertainty between a proposed production change and a safe operational decision. The platform assembles verifiable evidence, tests specific hypotheses and coordinates policy-controlled actions. Cross-industry applicability comes from operational abstractions, not an assumption that all industries have identical controls.

Primary users are service owners, platform engineers, SREs, security reviewers and change approvers. Compliance reviewers consume evidence exports; they do not delegate legal decisions to an agent.

## Core workflows

1. Assess a code, infrastructure, configuration or feature-flag change.
2. Discover affected dependencies and unknown ownership.
3. Retrieve relevant contracts, runbooks and prior failure patterns.
4. Propose falsifiable hypotheses and targeted tests.
5. Execute approved diagnostic tools against read-only sources.
6. Rehearse changes using synthetic workloads in disposable environments.
7. Compare availability, latency, saturation and data-integrity signals.
8. Assemble a reviewable action with evidence and recovery prerequisites.
9. Obtain an independent, scoped approval.
10. Supervise a limited rollout and halt on defined failure signals.
11. Investigate unexpected outcomes and route to the responsible owner.
12. Turn validated lessons into regression tests and reviewed policies.

## Requirements and acceptance criteria

| ID | Requirement | Acceptance evidence |
|---|---|---|
| FR-01 | Deduplicate incoming change events | Replaying an event creates one logical investigation |
| FR-02 | Preserve evidence provenance | Every factual finding has a source reference, timestamp and scope |
| FR-03 | Enforce retrieval authorization | Negative tests cannot retrieve another tenant's document or citation |
| FR-04 | Bind approval to action | Modified target, diff, evidence or policy invalidates authorization |
| FR-05 | Support abstention | Missing capacity or stale telemetry produces a hold, not a guessed answer |
| FR-06 | Verify outcomes | Execution success alone never marks a change healthy |
| NFR-01 | Recover durable workflows | Worker restart does not duplicate an external side effect |
| NFR-02 | Limit resource use | Tenant concurrency, token and execution budgets are enforced |
| NFR-03 | Remain independently deployable | Core control plane can run without the maintainer's hosted services |
| NFR-04 | Support accessible operations | Keyboard-operable approvals, textual evidence and non-color-only statuses |

These are target requirements, not completed acceptance results.

## Boundaries

Not a clinical decision system, fraud adjudicator, autonomous trading engine, industrial safety controller or legal compliance assessor. Initial scope excludes patient records, payment card data and customer message bodies. It does not promise universal root-cause discovery, exact digital twins or automatic safe rollback for every migration.

## Product experience

The landing page is a prioritized change queue. A change detail view contains a dependency map, evidence timeline, hypothesis table, test matrix, proposed diff and approval history. The operations view shows ongoing workflows and quarantined workers. Search is optional; conversation is not the transaction model.

Measure usefulness against ordinary CI and rules-based checks. Agent complexity is justified only when it improves investigation coverage or decision quality at an acceptable cost. Validate demand through interviews with service owners and incident responders before claiming market fit.
