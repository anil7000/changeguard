# Validation

Run the regression and integration suite from the repository root:

```text
node --test test/*.test.mjs demo/*.test.mjs
node tools/check-docs.mjs
node demo/evaluate.mjs
```

The suite covers tenant isolation, roles, source trust, TLS credential handling, telemetry validation, duplicate alert delivery, connection revision conflicts, collection retries, authority withdrawal, restart recovery, audit pagination, RAG grounding and synthetic execution safeguards.

Integration tests use local HTTP telemetry and model protocol doubles. They verify transport and workflow behavior, not model accuracy or compatibility with every hosted service.

With real configured models and the application running:

```text
node tools/doctor.mjs
node tools/assess.mjs
node tools/smoke.mjs
```

The assessment command without a file uses a clearly labeled synthetic scenario. The smoke command exercises independent approval and execution against a synthetic fixture only. Both retain investigation/audit records in the selected installation. Prefer a disposable installation for release validation.

[Continuous integration](https://github.com/anil7000/changeguard/actions/workflows/validate.yml) exercises Windows, Linux, macOS and the container workflow. A passing test run is not a claim of production-scale capacity, model reliability, security certification or cloud-provider acceptance.
