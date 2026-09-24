# Release verification: v0.2.0

## Current release: defect reproduction and repair

Date: 24 September 2026. Native environment: Windows x64, Node 24.19.0, Intel i7-1270P, approximately 31 GiB system RAM. This section supersedes the historical v0.1 evidence below.

Before implementation, `node --test test/regressions.test.mjs` reproduced **five failing tests, zero passing**:

| Defect | Observed failure | Repair and regression evidence |
|---|---|---|
| R1: invalid safety timestamps | Invalid approval expiry passed `Date.parse` comparisons; invalid/future investigation times were not rejected | Explicit finite/range checks; malformed, future and expired values fail closed |
| R2: queue quota bypass | Twenty pending jobs followed by 201 completed records disappeared from the quota's latest-200-record view | Indexed database count over all pending tenant records |
| R3: repeated full-history scan | An idle worker deserialized all completed history twice per tick | State expression index and pending-only queries; regression forbids calling the full-history reader |
| R4: missing AI accepted | No configured model returned a successful deterministic analysis | Required model/embedding calls; failure holds the workflow |
| R5: empty findings accepted | A response with no hypotheses passed validation | Nonempty bounded findings and citation validation |

After fixes, all five regression tests passed. Subsequent review expanded the suite and found additional issues:

- Missing/numeric service IDs were accepted through regex coercion. A newly added test failed before the explicit string check and passed afterward.
- Source metadata was not part of the old evidence fingerprint. Fingerprints now cover title, source, text and expiry; edits invalidate cached vectors and stale approvals.
- A globally serialized worker blocked unrelated tenants. Workers now allow bounded cross-tenant progress while serializing each tenant; a blocked-tenant regression verifies it.
- Dashboard polling transferred complete incident/runbook bodies. Summary endpoints now omit those bodies; details are loaded on selection with session/selection race checks.
- Model context/response size, vector dimensions/indexes, redirects, invalid vectors, output truncation and evidence withdrawal during inference have explicit tests.

### Real-model QA found failures that protocol doubles did not

Downloaded the official Ollama 0.34.4 Windows portable runtime and checked its release-asset SHA-256: `535193f38f3344e5b08f5d1c171c31ce11aa17f0124ff69ae26d8ec7fe06fa62`.

Pulled real `qwen3:4b` (2,497,293,931 bytes) and `qwen3-embedding:0.6b` (639,150,858 bytes), served on local loopback port 11435. No paid inference calls were made. The imported runbooks and incident bundle were synthetic repository examples.

1. First run: **HELD**, approximately 136 seconds. Qwen cited runbooks for numerical tool observations. The existing grounding check caught the missing tool references. Replaced the ambiguous citation contract with separate tool-observation and runbook fields.
2. Second run: the workflow reached `ANALYZED` in 219,037 ms, but **manual quality review rejected the result**. Qwen reversed a dependency direction and used causal certainty; the same-model critic incorrectly accepted those claims. This run is not counted as a quality pass.
3. Corrective implementation: source service and affected services are structured fields validated against graph reachability; the summary is built from computed facts; mechanisms are explicitly unverified and cannot contain numerical claims or obvious causal-certainty phrases. A regression now rejects the exact reverse-path/causal-claim failure class. The planner rationale is labeled unverified in the UI.
4. Third run: completed in 178,191 ms with valid structured impact paths and explicitly uncertain mechanisms. Manual review still found invented facts in the critic's free-form explanations. Replaced those explanations with a bounded classification-code contract and smaller per-stage output-token budgets. The critic remains a fallible model check, not independent assurance.
5. Final run: **ANALYZED**, 108,767 ms worker time / 110,242 ms client elapsed time. Three real model calls, three read-only tools, cached real embeddings, two structured hypotheses, valid database-to-checkout/payments paths, computed summary and bounded review codes. Job `34a78019-be57-44e6-8d4f-1e8a3f13a842`. Ollama reported zero VRAM usage for both models (CPU execution). This is one synthetic scenario, not a representative accuracy benchmark or a production RCA validation.
6. Real-model synthetic execution smoke: **COMPLETED**, job `7a5b8db0-99e7-4c7d-8852-020001a56e14`; independent reviewer approval, 3/3 rehearsal probes, 3/3 postcondition probes, target revision 5. Only the local synthetic target changed.

### Performance evidence

`node tools/benchmark.mjs`: 20,000 completed records, in-memory SQLite, sequential polling. Indexed worker p50/p95: 0.0132/0.0217 ms (1,000 samples). Legacy double full-scan p50/p95: 65.3594/129.7007 ms (25 samples). Pending-count p95: 0.0151 ms. This excludes disk, HTTP and inference.

`node tools/benchmark-http.mjs`: 100 sequential authenticated local summary requests, average response 1,296 bytes, p50 15.87 ms, p95 29.99 ms. This is not a concurrent load test or an enterprise SLO.

Local CPU inference takes minutes, not milliseconds. API responsiveness and model completion latency must not be conflated. Java/Python model-inference benchmarks were not performed.

### Current platform and UI checks

- Native Windows: **61/61 passed** on the final expanded suite, including the five initial regressions and subsequent grounding/queue/recovery repairs.
- WSL Oracle Linux: **61/61 passed** under a checksum-verified temporary Node 24.21.0 runtime; no system-wide Node installation was changed.
- Chrome disposable installation: login, fresh synthetic bundle loading, submission, `ANALYZED` state, service-owner impact table, stored tool receipts and absence of execution controls for assessments verified. Browser uses a protocol double; it is not the real-model-quality test above.
- Browser exports: investigation JSON (8,265 bytes) and audit JSON (948 bytes) were downloaded to the local Downloads folder; exported JSON parsed successfully. No browser console errors were observed during the checked workflow.
- Documentation checker: 16 Markdown pages, local links, balanced fences, hidden characters and six README Mermaid blocks. Diagram rendering is checked separately after publication.
- No production infrastructure, commercial model account, SSO, multi-node failover or compliance certification was tested.

## Historical v0.1 verification (not evidence for untested v0.2 behavior)

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
