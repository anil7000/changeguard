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
5. Expanded suite: all 38 tests passed locally; repeated full-suite runs also passed.
6. Browser QA found unchanged polling rebuilt rows and could interrupt clicks/focus. The frontend now preserves unchanged views. Status messages now reflect approval and execution stages, and transient notifications dismiss automatically.

## Observed end-to-end results

- Native CLI smoke: COMPLETED; rehearsal 3/3 passed, verification 3/3 passed, target revision advanced from 1 to 2.
- Chrome UI: engineer login, change submission, evidence inspection, reviewer login/approval, engineer execution and COMPLETED status all exercised. Verification displayed 3 successful probes and zero failures. No browser console errors were recorded during this workflow.
- All six Mermaid diagrams rendered as diagram documents in GitHub's README. Wide layouts were subsequently changed to top-down flow for readability.

Covered: complete workflow, actual HTTP probes, missing/excess capacity, authentication, tenant separation, role checks, self-approval, stale approvals, action tampering, target drift, source withdrawal, malicious runbook instructions, idempotency, cancellation, database atomicity, exclusive ownership, restart recovery, synthetic rollback and model response/citation validation.

## Platform evidence

[GitHub Actions run 36000313730](https://github.com/anil7000/changeguard/actions/runs/36000313730), implementation commit `a35b42c`: Windows, Ubuntu, macOS and Linux container jobs all completed successfully. Native jobs ran the 38-test suite and documentation checks. The container job built the image, reached readiness, completed the full smoke workflow and passed the suite inside the container.

Direct WSL verification also passed all 38 tests: OracleLinux_8_7 on WSL2, Linux kernel 5.15.167.4-microsoft-standard-WSL2, x86_64, Node.js v24.21.0. The existing system Node.js v22.22.0 was left unchanged; a temporary official Node.js 24 archive was checked against the publisher's SHA-256 manifest and used only for the test. Test databases were created in the distribution's temporary directory.

The reviewed-file importer successfully ingested the included connection-pool runbook into the native installation. A subsequent smoke run again reached COMPLETED with 3/3 rehearsal probes and 3/3 verification probes passing.

## Limits

No live hosted model provider was called. Model integration tests use real loopback HTTP test doubles. No production telemetry connector, production mutation or compliance certification is claimed. The worker process executes fixed trusted fixture code, not arbitrary uploaded code. Architecture diagram rendering and browser checks are recorded separately when actually performed.
