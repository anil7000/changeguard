# ChangeGuard

## Production change assurance across industries

ChangeGuard is an event-driven engineering platform design for investigating changes, rehearsing failure scenarios and authorizing bounded operational actions. Its primary interface is a change workspace, not a chatbot.

**Status: architecture specification plus a runnable offline policy demonstrator.** The distributed platform, UI, connectors, RAG service and production execution workers are not implemented. The demonstrator makes no external calls and cannot change infrastructure. No production adoption, compliance certification or performance improvement is claimed.

Owner and maintainer: Anil Kumar Tangirala.

## The problem

A change that passes a service's tests can exhaust a shared dependency, expose sensitive data or make recovery unsafe. Reviewers need evidence across repositories, infrastructure, telemetry and operational history. ChangeGuard's proposed contribution is a traceable chain from change to dependency analysis, executable rehearsal, scoped approval and outcome verification.

It complements CI/CD and observability rather than replacing them. RAG retrieves permission-filtered evidence; language models propose investigations and tests; deterministic policy decides whether an action may proceed.

## Documentation

| Page | What it explains |
|---|---|
| [Product and scope](docs/01-product.md) | Users, problem, requirements, boundaries and outcomes |
| [System architecture](docs/02-architecture.md) | Context, control plane, execution plane and domain boundaries |
| [Hosting and dependencies](docs/03-hosting.md) | Standalone, private cloud, disconnected and regional designs |
| [Data, RAG and integrations](docs/04-data-and-integrations.md) | Contracts, evidence lineage, permissions and connector semantics |
| [Security](docs/05-security.md) | Trust boundaries, threats, identities and tenant isolation |
| [Safety](docs/06-safety.md) | Approval binding, state transitions, recovery and failure behavior |
| [Compliance and governance](docs/07-compliance.md) | Proposed controls, evidence, responsibilities and limitations |
| [Industry scenarios](docs/08-industry-packs.md) | Healthcare, retail, finance, SaaS, manufacturing and public services |
| [Independent usage](docs/09-usage.md) | Runnable local demo and proposed onboarding journey |
| [Operations](docs/10-operations.md) | Recovery, monitoring, upgrades, cost and failure runbooks |
| [Delivery and evaluation](docs/11-delivery.md) | Milestones, acceptance gates, tests and decision records |
| [Sources and assumptions](docs/12-sources.md) | Industry evidence and official reference material |

## Run the implemented demonstration

Prerequisite: Node.js 22 or newer. No account, API key, cloud subscription, container runtime or external package is required.

```sh
node demo/evaluate.mjs
node --test demo/evaluate.test.mjs
node tools/check-docs.mjs
```

Run these commands from this directory. The first command prints four synthetic change decisions; it does not deploy the proposed platform. See [usage](docs/09-usage.md) for inputs, limitations and expected results.

## Architectural invariants

- No model holds production credentials or grants permissions.
- Missing evidence is unknown, never a low-risk score by default.
- Approval is bound to a specific immutable action and expires.
- Rehearsal results are evidence, not proof that production will behave identically.
- A platform outage must not prevent existing services from running.
- Sensitive business records are not required for the baseline workflows.

## Contribution and ownership

Changes should include a testable scenario, threat/safety impact and updated documentation. Do not contribute secrets, customer data or employer-owned material. Third-party components remain subject to their own licenses. A redistribution license for this new project has not yet been selected; publication alone does not grant an open-source license.
