# Release verification: v0.1.0

## Scope and reproducibility

The tested product is the native Node.js application and synthetic HTTP action adapter. No production infrastructure is modified by the tests. Run from the repository root:

```sh
node --test test/*.test.mjs demo/*.test.mjs
node tools/check-docs.mjs
```

For an already running local installation with initialized credentials:

```sh
node tools/smoke.mjs
```

The smoke test submits a change, waits for real rehearsal, approves with a separate configured identity, executes against the local fixture and checks successful verification. It leaves its change and audit records in that installation. Run against a disposable test installation when you want a clean data set.

## Local test cycles

Environment: Windows, Node.js v24.19.0, built-in SQLite 3.53.3.

1. Initial integration run: 26 passed, 7 failed. Root cause: explicitly exiting the fixture child while Windows IPC handles were closing triggered a libuv assertion. Changed the child to disconnect and exit naturally.
2. Rerun: all 33 tests passed.
3. Additional review found a seed runbook could be recreated after deletion on restart; limited seeding to first tenant initialization. Added a regression test.
4. Added exclusive database ownership and restart/rollback tests. Fixed a frontend logout race by discarding responses from an earlier session.
5. Expanded suite: all 38 tests passed locally at this checkpoint.

Covered: complete workflow, actual HTTP probes, missing/excess capacity, authentication, tenant separation, role checks, self-approval, stale approvals, action tampering, target drift, source withdrawal, malicious runbook instructions, idempotency, cancellation, database atomicity, exclusive ownership, restart recovery, synthetic rollback and model response/citation validation.

## Platform evidence

GitHub Actions is configured to execute tests on Windows, Ubuntu and macOS, plus a Linux container build and end-to-end smoke test. Configuration is not a passing result: inspect the run associated with the published commit. WSL is documented but requires a separate real WSL run before claiming direct WSL verification.

## Limits

No live hosted model provider was called. Model integration tests use real loopback HTTP test doubles. No production telemetry connector, production mutation or compliance certification is claimed. The worker process executes fixed trusted fixture code, not arbitrary uploaded code. Architecture diagram rendering and browser checks are recorded separately when actually performed.
