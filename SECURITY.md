# Security and deployment boundaries

ChangeGuard is an operational evidence processor. Treat telemetry, runbooks and model output as untrusted input and retained investigations as potentially sensitive records.

## Enforced controls

- Per-request bearer identity, role checks and server-derived tenant boundaries.
- Ingestion-only collector identities cannot read investigations or execute actions.
- Per-tenant host-authorized source origins; browser admins cannot choose arbitrary secret names.
- No outbound redirects; finite response/request limits; source credentials require HTTPS outside exact loopback.
- Connection revisions and policy/authority rechecks before collected evidence becomes an investigation.
- Required schema, freshness, citation and dependency validation; missing or malformed telemetry fails closed.
- Bounded queues, rate limits, retries, tool counts and model context.
- No shell tools, raw infrastructure commands or production write adapters.
- Independent approval and exact-action checks apply only to the separate synthetic execution lab.

## Operator responsibilities

Use TLS termination and enterprise identity/access controls before network exposure. This release uses host-provisioned bearer identities, not native OIDC/SSO. Do not trust arbitrary identity headers from a proxy.

Keep tokens, source credentials, model API keys, database files, exported investigations and configuration backups private. Bind to loopback unless a reviewed gateway/network boundary protects the deployment.

Use read-only monitoring credentials and a dedicated collector identity for each ingress integration. Scope source queries to permitted services. Origin allowlisting is not a replacement for egress firewall controls: trusted DNS/endpoints must not be allowed to resolve to unauthorized management or metadata networks. Direct common metadata endpoints are rejected, but deployment network policy remains essential.

Prompt text never grants execution authority. Review generated hypotheses against source evidence. A supported hypothesis is not a confirmed root cause or an approved remediation.

Configure disk encryption, retention/erasure procedures, isolated backups and independent audit archival. Local hash-linked audit records can be rewritten by someone controlling the database. Deleting a runbook does not delete historical report snapshots.

## Deployment assurance

Single-process SQLite ownership is not high availability. No HIPAA, PCI DSS, SOC 2 or other certification is claimed. Validate representative incidents, dependency mappings, model behavior, load, recovery objectives and organization-specific controls before a production rollout.

Report suspected vulnerabilities through a private channel available on the maintainer's GitHub profile. Do not post credentials or sensitive production evidence in public issues.
