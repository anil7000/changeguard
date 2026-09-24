# Compliance, privacy and governance

> Future architecture reference. The implemented v0.1 behavior, diagrams, installation and usage are documented in the [main README](../README.md). Statements below describe target architecture unless explicitly stated otherwise.


[Documentation index](../README.md)

This is an engineering control design, not legal advice, certification or a claim of HIPAA, PCI DSS, GDPR, SOC 2 or ISO compliance. Applicability depends on jurisdiction, data flows, contractual roles and deployment. A qualified organizational reviewer must determine obligations before regulated use.

## 9. Evidence and accountability

See the [architecture diagrams in the main README](../README.md#architecture-diagrams).

## Proposed control mapping

| Area | Platform contribution | Organization responsibility | Evidence |
|---|---|---|---|
| Access control | Scoped identities, independent approval and revocation | Role assignment and periodic reviews | Access review and denial logs |
| Change management | Immutable diffs, tests and approval binding | Authorized approvers and release policy | Change evidence bundle |
| Privacy | Minimization, redaction and regional routing | Lawful processing basis and approved data flows | Data inventory and flow assessment |
| Retention | Per-class expiry and deletion reconciliation | Retention schedule and legal-hold decisions | Deletion receipts and hold register |
| Incident response | Workflow history and exportable evidence | Notification decisions and response ownership | Incident timeline and reviewed report |
| Supplier risk | Model endpoint inventory and routing restrictions | Vendor assessment and required agreements | Provider register and contracts |
| AI governance | Version tracking, evaluation and abstention | Accepted use cases and accountable owner | Evaluation results and risk register |

HIPAA cloud use can involve business-associate responsibilities and agreements; private hosting by itself is not sufficient. See [HHS cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html). Keep ePHI out of the initial deployment.

For payment environments, determine actual cardholder-data scope and applicable controls with the organization's assessor. Do not ingest PAN or sensitive authentication data into prompts. See the [PCI SSC standards library](https://www.pcisecuritystandards.org/document_library/).

Use the [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) as a voluntary risk-management reference, not a certification badge. Additional country-specific privacy, sector and AI obligations require separate assessment; this package does not map every law worldwide.

## Retention and immutable records

Keep audit event metadata separate from raw evidence. Apply an approved retention period to each class. Object locking must match that schedule; an unlimited immutable archive conflicts with minimization. Legal holds must be authorized, scoped and audited. Deleting source content must reconcile indexes, embeddings, caches, replicas and backup expiry according to the approved process.

Do not export raw customer data merely to make an audit easier. An evidence bundle should contain hashes, decisions, source pointers and authorized excerpts, with access controls and a manifest. Hashes establish integrity relative to a captured artifact; they do not prove the source was truthful.
