# Cross-system workflow contract

## Event ingress

`POST /api/workflows` requires bearer authentication (operator or collector), JSON and an `Idempotency-Key` of 8–100 safe characters. Tenant comes from identity, never the payload.

```json
{
  "binding": "transaction-recovery",
  "resource": "demo-1",
  "source": "ticket",
  "externalId": "ticket-1234",
  "summary": "Paid order has no fulfillment handoff"
}
```

Sources: `event`, `ticket`, `chat`, `schedule`, `manual`, `cicd`. These record provenance, not native vendor connectivity. An integration gateway authenticates its provider, maps its payload and selects a preconfigured binding. Stable `(tenant, binding, source, externalId)` identifies an event independently of delivery keys. Changed content under an existing identity returns 409. New business events need new external IDs.

Collectors receive only ID, state and external event ID, including on replay. Viewers can read tenant workflows; operators can submit/resume/cancel eligible work; independent approvers can approve exact plans. Host configuration, not browser input, controls execution policy.

## One-time binding configuration

Merge this structure into private configuration, substitute approved endpoints, provision a same-tenant `order-events` collector and ingest `approved-order-recovery` through the document API:

```json
{
  "connectorOrigins": [
    { "tenant": "local", "origin": "https://operations-gateway.example.com", "secretEnv": "CG_SOURCE_OPERATIONS" }
  ],
  "workflowBindings": [{
    "id": "orders-production",
    "tenant": "local",
    "pack": "transaction-recovery",
    "environment": "production",
    "enabled": true,
    "mode": "approval",
    "resourcePrefix": "order-",
    "procedureIds": ["approved-order-recovery"],
    "initiators": ["order-events"],
    "adapters": {
      "payment": { "endpoint": "https://operations-gateway.example.com/payments" },
      "inventory": { "endpoint": "https://operations-gateway.example.com/inventory" },
      "fulfillment": { "endpoint": "https://operations-gateway.example.com/fulfillment" }
    },
    "notificationEndpoint": "https://operations-gateway.example.com/status"
  }]
}
```

Inject `CG_SOURCE_OPERATIONS` into the server environment. `initiators` narrows allowed operator/collector identities; omission permits those roles within the tenant. Always narrow it for production automation. Mode is `approval` or `automatic`; both retain all evidence, model, revision and state checks. Source origins are exact and tenant-scoped. Remote secrets require HTTPS; redirects and event-selected destinations are forbidden. Network/DNS egress controls remain necessary.

## Adapter reads and writes

`GET {endpoint}/v1/resources/{resource}` returns a fresh authoritative snapshot:

```json
{
  "id": "order-1234",
  "version": 7,
  "observedAt": "2026-09-24T12:00:00.000Z",
  "data": { "status": "available" }
}
```

Observation age must be within 60 seconds; do not timestamp stale cached data as fresh. Version is a positive safe integer that changes on every relevant mutation. Responses are capped at 64 KB, requests at 10 seconds. IDs must match. Missing information must not become an approved/healthy value. Models see only declared condition fields, but raw snapshots are retained: minimize sensitive adapter data.

The engine persists intent before `PUT {endpoint}/v1/operations/{id}`:

```json
{
  "id": "workflow-uuid-0",
  "kind": "apply",
  "resource": "order-1234",
  "role": "inventory",
  "expectedVersion": 7,
  "from": { "status": "available" },
  "to": { "status": "reserved" },
  "workflow": "workflow-uuid"
}
```

Adapters must independently authorize credential, tenant, resource, role and exact transition; atomically compare revision/from-state, apply the effect and record a durable receipt. Equivalent provider-backed idempotency is acceptable; otherwise automatic execution is unsafe.

A receipt contains `id`, `resource`, `requestDigest`, `status: "applied"`, new `version` (expectedVersion + 1) and resulting `data`. `requestDigest` is SHA-256 of the exact emitted UTF-8 JSON request body; preserve property order or use the shared `digest` implementation. Reordered JSON changes this version of the protocol.

`GET /v1/operations/{id}` returns that receipt or 404 for genuine absence. Repeated identical PUTs return the same receipt; conflicting requests under one operation ID are rejected. **HTTP 409 guarantees that request had no effect.** Never return 409 after uncertain or committed execution. Operation records must survive restart. Concurrent requests must not duplicate an effect.

Timeouts trigger receipt lookup before a repeated PUT. Three bounded transient retries use persisted backoff and the same intent. This is at-least-once delivery with idempotent effects, not global exactly-once execution.

## Outcome verification and compensation

After actions, the engine reads every authoritative role again, checks declared postconditions and owned action revisions. Model text or acknowledgments cannot complete a workflow.

A known later action rejection or a failed postcondition schedules reverse-order compensation of owned writes where revisions permit it. Compensation has a stable `-undo` operation ID, `kind: "compensate"`, the original receipt revision and reversed from/to conditions. It requires the same adapter authorization, durable receipt and compare-and-set guarantees.

External revision conflicts halt compensation. Irreversible actions, including dispatched shipments, cannot be represented as trivially reversible status changes. Qualify real compensating business actions or require human handling. `COMPENSATED` means owned writes were reversed and checked; the original problem remains unresolved.

`HELD` retains locks and evidence. Operators may resume after resolving a service/evidence issue or cancel work without possible effects. Revoked authority or unresolved external effects can require out-of-band domain reconciliation. There is deliberately no force-unlock endpoint.

## Custom packs

Add trusted definitions to the host's `workflowPacks` array:

```json
{
  "id": "supplier-handoff",
  "title": "Approved supplier handoff",
  "domain": "Supply chain",
  "objective": "Reconcile an approved purchase request with its supplier queue",
  "procedure": "Require approval. Queue the existing handoff once, verify it and reverse only an owned queue entry before dispatch.",
  "roles": ["purchase", "supplier"],
  "graph": [["purchase", "supplier"]],
  "guards": { "purchase": { "status": "approved" } },
  "steps": [{ "role": "supplier", "from": { "status": "pending" }, "to": { "status": "queued" } }]
}
```

Packs have 2–12 unique roles, at least one read-only guard and 1–12 unique target steps. Every role is guarded or transitioned. Edges follow guard-first ordered execution; cycles are rejected. Conditions are bounded scalar equalities, not executable expressions. Before/after field sets match. Bind the pack to qualified adapters and selected, explicitly ingested procedure IDs; embedded procedure text alone does not become authorized knowledge.

Pack/binding digests invalidate old plans after changes. Custom definitions are visible only to tenants with bindings. This DSL covers ordered reversible transitions, not arbitrary branching, loops or scripts.

## Schedules and notifications

Optional binding configuration:

```json
{
  "reconcile": {
    "identity": "order-events",
    "intervalSeconds": 300,
    "resources": ["order-1234", "order-5678"]
  }
}
```

The same-tenant identity must retain collector and initiator authority. Configure 1–20 scoped resources, interval 60–86400 seconds. This reconciles an explicit resource list; it does not discover enterprise resources. Active/held work is not stacked. Time-bucket event identities deduplicate restarts; missed intervals coalesce.

`notificationEndpoint` enables an atomic durable outbox. The worker posts to `{endpoint}/v1/events` with `Idempotency-Key`, workflow ID, source event ID, state, reason and a relative dashboard link. It excludes full snapshots and RAG text. Receivers deduplicate and route updates to the original ticket/chat. HTTP success means receiver acceptance, not proof a human saw it. Five failures leave a FAILED delivery record for operator inspection/replay through an approved process.

## API and pause controls

| Route | Purpose |
|---|---|
| GET /api/workflow-catalog | Visible packs, bindings and pause state |
| POST /api/workflows | Normalized event ingress |
| GET /api/workflows | Latest 200 tenant summaries, excluding full evidence |
| GET /api/workflows/:id | Complete tenant-scoped record |
| POST /api/workflows/:id/approve | Independent exact-plan approval |
| POST /api/workflows/:id/resume | Reconcile held work |
| POST /api/workflows/:id/cancel | Cancel without possible external effects |
| GET /api/workflow-deliveries | Latest 100 tenant notification records |

Set `workflowPaused: true` and restart to pause workflows/workers. Issued network requests cannot be recalled. Pause does not erase work, release locks or automatically compensate effects. This is separate from the supporting telemetry collector's `automationPaused` setting.
