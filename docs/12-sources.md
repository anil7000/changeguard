# Sources, assumptions and limits

[Documentation index](../README.md)

References checked during architecture preparation on 24 September 2026. These sources establish the problem or inform design; they do not endorse ChangeGuard.

- [Cloudflare November 2025 incident](https://blog.cloudflare.com/18-november-2025-outage/): a generated configuration failure illustrates cross-system change risk.
- [Cloudflare resilience plan](https://blog.cloudflare.com/fail-small-resilience-plan/): failure containment is an explicit engineering priority.
- [Meta incident investigation research](https://engineering.fb.com/2024/06/24/data-infrastructure/leveraging-ai-for-efficient-incident-response/): change ranking assists investigation but has uncertainty and requires validation.
- [Meta capacity efficiency, April 2026](https://engineering.fb.com/2026/04/16/developer-tools/capacity-efficiency-at-meta-how-unified-ai-agents-optimize-performance-at-hyperscale/): agent workflows extend to performance investigation and proposed changes.
- [Google configuration design](https://sre.google/workbook/configuration-design/): gradual rollout and recoverability inform safety requirements.
- [HHS cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html): healthcare deployments require more than technical hosting choices.
- [PCI SSC document library](https://www.pcisecuritystandards.org/document_library/): authoritative payment-security standards and assessment material.
- [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework): cross-sector risk-management reference.

## Explicit assumptions

Adopters can identify service owners, authorize connectors and define health conditions. Dependency observations are incomplete and may be stale. Synthetic workloads cannot perfectly reproduce customer behavior. A model's stated confidence is not a calibrated probability. Approvals require authenticated identities and trustworthy time. Organizations retain their existing incident command and emergency release processes.

## Differentiation hypothesis

The proposed emphasis is an independently deployable evidence-to-action chain with bounded execution and cross-industry policy overlays. This is a product hypothesis, not a claim of unique invention or a completed competitive analysis. Validate it with prospective users and benchmark against simpler tooling before expanding scope.
