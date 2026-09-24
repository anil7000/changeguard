# Integrations

## Prometheus

Authorize the source origin with `tools/sources.mjs`, restart the server, and configure the connection in the dashboard. An endpoint may include a path prefix, for example `https://metrics.example.com/prometheus`; authorization is for its exact origin.

The collector issues GET requests to `<base>/api/v1/query` with the same PromQL expression evaluated at capture time and at the configured baseline time. Expressions must return one scalar or a one-element instant vector. Rejects warnings, missing/multiple samples, invalid numbers and samples more than 120 seconds from requested time. Native histograms must be converted to a numeric expression.

Maximum 12 expressions per connection, four concurrent requests, 10-second request deadline, 60-second collection deadline and 1 MiB per response. Collection fails as a unit; partial telemetry is not submitted. HTTP 429, server errors and transport failures retry up to three attempts with bounded backoff.

Rate metrics use fractions (0–1); latency uses milliseconds; replication lag seconds; certificate lifetime days; queue depth count. Comparisons require equivalent units and meaningful measurement windows.

Source references identify the configured connection, environment and baseline window. Review the query mapping before enabling scheduling. `up` measures scrape health, not necessarily customer-visible availability.

Reference: [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/).

## Alertmanager

Create a dedicated collector identity:

```text
node tools/access.mjs add --id alertmanager --tenant local --roles collector
```

Restart the application. Deliver that identity's token to Alertmanager using your secret-management process. Configure its receiver:

```yaml
receivers:
  - name: changeguard
    webhook_configs:
      - url: https://changeguard.example.com/api/connections/production-metrics/alertmanager
        send_resolved: true
        max_alerts: 100
        http_config:
          authorization:
            type: Bearer
            credentials_file: /run/secrets/changeguard-token
```

The connection must exist and be enabled. Deploy a TLS gateway for non-loopback ingress; the example hostname is not a hosted service. Ensure your gateway forwards the bearer header without logging it.

Firing alerts enqueue telemetry collection. Resolved-only groups are acknowledged without investigation. Deduplication uses the connection and sorted firing-alert fingerprints/start times; reordered retries do not create new work. The same firing episode is collected once via webhook; use scheduled collection for continuing observation. Truncated groups are rejected. Alert annotations and generator URLs never become tool instructions or outbound destinations.

Reference: [Alertmanager webhook configuration](https://prometheus.io/docs/alerting/latest/configuration/#webhook_config).

## CI/CD deployment evidence

POST JSON to `/api/environments/<environment>/deployments` with `Authorization: Bearer <collector-token>` and `Content-Type: application/json`:

```json
{
  "id": "release-2026-09-24-01",
  "service": "application",
  "revision": "commit-or-image-digest",
  "description": "Connection configuration updated",
  "at": "<actual ISO-8601 deployment time>",
  "rollbackAvailable": true,
  "rollbackTestedAt": null
}
```

Use actual current timestamps. A deployment must be within the last 24 hours and name a service registered in that environment. `null` means recovery testing is unknown. Do not infer recovery proof from a successful build. Duplicate IDs with identical normalized evidence are accepted; conflicting payloads return 409.

Deployments are correlated to same-service/direct-dependency breaches within 15 minutes. This is temporal evidence, not proven causation.

## Universal evidence ingress

Any system capable of authenticated JSON POST can submit to `/api/events/evidence`:

```json
{
  "kind": "assessment",
  "title": "Investigate observed service degradation",
  "environment": "production",
  "bundle": {
    "capturedAt": "<actual ISO-8601 capture time>",
    "source": "approved monitoring export",
    "services": [{"id":"application","owner":"platform","tier":"critical","dependsOn":[]}],
    "signals": [{"id":"errors","service":"application","metric":"error_rate","before":0.002,"after":0.08,"limit":0.01,"observedAt":"<actual ISO-8601 measurement time>"}],
    "deployments": []
  }
}
```

Also supply a unique `Idempotency-Key` (8–100 letters, digits, underscores or hyphens). Reuse it only for an identical retry. The numeric values above are examples; replace them with actual measurements.

Bounds: 1–80 services, 1–120 signals, 0–80 deployment records, 100 KB HTTP body. Capture must be within 24 hours of submission; signal and deployment timestamps must be within the preceding 24-hour capture window. Unknown fields are removed before model use. Large valid bundles can still exceed the model context budget and be held; narrow the incident scope.

Seven supported metrics: error_rate, latency_p95_ms, saturation, queue_depth, availability, replication_lag_s, certificate_days. Raw log files are not an evidence bundle.

This protocol avoids application-code changes when a source can export this contract. It is not an automatic adapter for every vendor's raw payload.
