# Independent usage and adoption

> Future architecture reference. The implemented v0.1 behavior, diagrams, installation and usage are documented in the [main README](../README.md). Statements below describe target architecture unless explicitly stated otherwise.


[Documentation index](../README.md)

## What you can run now

Install Node.js 22 or newer using your organization's approved process. Obtain this directory and open a terminal in it. No npm installation is needed.

```sh
node demo/evaluate.mjs
node --test demo/evaluate.test.mjs
node tools/check-docs.mjs
```

Expected demonstration decisions:

| Fixture | Decision | Reason |
|---|---|---|
| healthcare-over-capacity | BLOCK | Proposed pool demand exceeds the supplied capacity budget |
| retail-missing-capacity | HOLD | Capacity evidence is missing |
| retail-awaiting-review | REVIEW | Capacity passes but approval is absent |
| saas-approved | ELIGIBLE | Demonstration checks pass; nothing is executed |

## Supply your own synthetic fixture

Create a JSON object with the same fields as [the fixtures](../demo/scenarios.json), then run:

```sh
node demo/evaluate.mjs path/to/synthetic-change.json
```

Required fields: `id`, positive integer `replicas`, positive integer `poolPerReplica`, positive integer `capacityBudget`, boolean `evidenceFresh`, and boolean `rollbackTested`. `capacityBudget: null` represents missing evidence. Optional approval contains `actionId`, `independent`, and `valid`. These booleans are simulation inputs, not authenticated security assertions.

The pool-demand model is replicas multiplied by per-replica connections. Supply a capacity budget already allocated to this service after reserving capacity for other clients. This is a conservative static check, not a database performance model. It does not analyze actual telemetry, use an LLM, perform RAG, verify signatures or call external tools.

The demonstration prints JSON to stdout and writes no data. Remove the copied directory to uninstall it; no service or scheduled job remains. Do not feed secrets or regulated records into fixture files.

## Proposed full-platform onboarding

These steps describe the future product, not available commands:

1. Select a hosting mode and name an operational owner.
2. Review data classifications, residency, suppliers and target scope.
3. Configure identity and independent approver roles.
4. Register read-only source-control and telemetry connectors.
5. Import service ownership and dependency records.
6. Run synthetic scenarios and tenant-isolation tests.
7. Operate in shadow mode: compare decisions without controlling changes.
8. Enable isolated rehearsal and evaluate false alarms.
9. Permit PR preparation for designated repositories.
10. Enable narrowly scoped production actions only after safety acceptance.

## Troubleshooting

If `node` is not found, install the approved runtime and reopen the terminal. If fixture parsing fails, verify valid JSON and required field types. HOLD means evidence or prerequisites are insufficient; do not replace unknown values with arbitrary numbers to obtain eligibility. ELIGIBLE is only a local simulation result, never permission to execute against a live system.

For an independent adopter, the architecture deliberately avoids a maintainer-controlled SaaS dependency. Actual installable deployment artifacts are a delivery milestone and are not yet supplied.
