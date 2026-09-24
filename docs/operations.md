# Operating ChangeGuard

The primary workspace at `/` manages cross-system recovery; telemetry investigations move to `/investigations`. See the [workflow contract](workflows.md) for packs, bindings, initiators, schedules and notification receivers. The reference launcher uses port 4315 and `data/reference`; normal installations use port 4310.

Workflow limits: 20 nonterminal records per tenant including held/review work, two concurrent tenant workers and serialization within each tenant. Transient adapter failures retry at most three times with persistent backoff. Five notification failures leave a failed outbox record. These are bounded local defaults, not production throughput claims.

`workflowPaused` controls cross-system workers; `automationPaused` controls telemetry collection. Disable individual bindings through host configuration and restart. Policy changes invalidate old plans. Review held effects before revoking authority because that may intentionally prevent automatic compensation.

## Service ownership

Run one application process per SQLite database. A filesystem process lock enforces exclusive ownership. Use a protected persistent local disk, not a database concurrently shared between containers, hosts or Windows/WSL instances. Containers run without root, with dropped capabilities and a read-only filesystem except data/tmp.

Application defaults: loopback port 4310, local Ollama port 11434. Set `CG_PORT`, `CG_HOST`, `CG_CONFIG`, `CG_DB` and `CG_URL` for explicit deployment paths/endpoints. `CG_MODEL_BASE` overrides the local Ollama origin; it is a privileged host setting. `CG_LLM_API_KEY` supplies a compatible hosted-model credential.

## Identity and source configuration

`node tools/access.mjs add|rotate|roles|remove --id NAME --tenant TENANT [--roles viewer,operator]` manages private local identities. `node tools/sources.mjs allow|remove --tenant TENANT --origin https://metrics.example.com [--secret-env CG_SOURCE_METRICS]` controls outbound source trust.

Both require host filesystem access and take effect after restart. They preserve a private backup; restrict backup permissions as carefully as the active file. Windows users must restrict directory ACLs; POSIX users should restrict the directory to the service account. Runtime bearer tokens are not a substitute for enterprise SSO.

Inject source secrets into the application process, not the browser. Compose users must explicitly forward source variables using their deployment's environment/secret mechanism. Environment variable names must begin `CG_SOURCE_`. No TLS certificate validation bypass is provided; supply organization-approved trust roots through the runtime's supported configuration.

## Autonomy controls

A connection defines an environment, service map, queries, thresholds, baseline, question, enabled state and interval. Interval 0 means manual/webhook only; otherwise 60–86400 seconds. Administrators can enable schedules without operator interaction, so treat the admin role as automation-policy authority.

Disable a connection from the dashboard to stop future collection and invalidate in-flight collection before submission. Existing submitted investigations remain read-only and may finish. To pause all collection, set `automationPaused: true` in the private configuration and restart. It does not cancel already submitted AI investigations.

Maximum 20 connections, 20 pending collection jobs and 20 pending investigations per tenant. Collectors run with at most two tenant jobs concurrently; each tenant is serialized. AI worker concurrency defaults to two tenants and is bounded to eight. Scheduled collection does not stack another pending collection for the same source. Missed intervals coalesce; there is no historical replay.

Schedules and jobs persist. After restart, incomplete collections resume; a previously committed assessment is recovered without submitting it twice. Collection `SUBMITTED` is distinct from investigation `ANALYZED`.

## Diagnostics

```text
node tools/doctor.mjs
```

- `/healthz`: process liveness and release version.
- `/readyz`: database readiness, not model or telemetry-source readiness.
- `/api/operations`: authenticated tenant queue counts, model configuration and supported capabilities.
- `/api/collections`: latest 100 collection jobs and failure/retry reasons.
- `/api/changes`: latest 200 investigation summaries; select an ID for full evidence.

The diagnostic command also checks locally configured Ollama model installation. It does not claim inference quality or source accessibility. Use **Collect now** to validate a real source and inspect its job outcome.

Failures:
- 401/403: identity or role issue; do not share tokens in diagnostic tickets.
- 409: stale connection revision, disabled source, paused collection or conflicting evidence ID.
- 429: per-identity request rate or tenant queue quota.
- FAILED collection: check source authorization, credentials, TLS, query cardinality, data availability and schema.
- HELD investigation: inspect missing/stale runbook evidence, model availability, context limits, citations or review rejection.

## Audit and data lifecycle

`GET /api/audit` returns the latest 500 tenant events in ascending sequence order. For a complete incremental export, start with `?after=0&limit=1000`, persist each batch, then request after the last returned sequence until empty. Global sequence gaps between tenant events are normal. Verify each hash against the previous stored event; a recent page alone is not a complete chain.

Protect exported reports. Evidence deletion prevents future retrieval but does not erase snapshots already retained in investigations. There is no automatic retention/erasure service. Capacity planning and organization-specific retention controls are required. Local hash chains are not independently immutable; archive to a separately controlled destination.

For a consistent backup: stop the server, copy the complete private data directory including SQLite WAL/SHM files, store it with restricted access, and validate restoration in an isolated instance. Test token/source configuration and database restore together. Never remove a live process lock to force a second writer.

## Upgrade

Stop the service and back up data before upgrading. Pull the release, run the regression suite, then restart. Database tables/indexes migrate at startup without deleting existing investigations. Existing v0.2 configuration and tokens remain valid. Industry fields remain accepted for older API clients but no longer drive the UI or investigation workflow.

## API

All `/api/*` routes use bearer authentication. Tenant identity is server-derived. JSON mutations require the appropriate role.

| Route | Purpose |
|---|---|
| GET /api/me | Current identity and roles |
| GET/POST /api/connections | List / create or revision-update saved connections |
| POST /api/connections/:id/collect | Queue a read-only source collection; idempotency key required |
| POST /api/connections/:id/alertmanager | Alertmanager v4 ingress |
| GET /api/collections | Collection outcomes and investigation links |
| POST /api/events/evidence | Push a normalized read-only assessment |
| POST /api/environments/:environment/deployments | Record a deployment event |
| GET /api/operations | Tenant operational status |
| GET /api/access | Administrator-only identity metadata and authorized origins; no tokens |
| GET/POST /api/changes | List / submit investigations or synthetic lab proposals |
| GET /api/changes/:id | Full investigation |
| POST /api/changes/:id/cancel | Cancel eligible non-running investigation |
| GET/POST /api/documents | List / ingest reviewed runbooks |
| DELETE /api/documents/:id | Withdraw a source from future retrieval |
| GET /api/audit | Bounded, cursor-paginated audit |
| POST /api/changes/:id/approve or execute | Independent approval / execution in the synthetic lab only |
