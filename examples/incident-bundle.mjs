// Synthetic scenario generator: current timestamps make replay freshness explicit.
export function incidentBundle(clock = Date.now()) {
  const at = seconds => new Date(clock-seconds*1000).toISOString();
  return { capturedAt: at(0), source: 'synthetic retail incident; replace with reviewed operational exports',
    services: [ { id: 'checkout', owner: 'commerce', tier: 'critical', dependsOn: ['payments','database'] }, { id: 'payments', owner: 'payments-platform', tier: 'critical', dependsOn: ['database'] }, { id: 'database', owner: 'data-platform', tier: 'standard', dependsOn: [] } ],
    signals: [ { id: 'db-pressure', service: 'database', metric: 'saturation', before: 0.42, after: 0.96, limit: 0.8, observedAt: at(30) }, { id: 'checkout-errors', service: 'checkout', metric: 'error_rate', before: 0.002, after: 0.12, limit: 0.01, observedAt: at(20) } ],
    deployments: [ { id: 'deploy-42', service: 'database', revision: 'config-42', description: 'Connection capacity changed during rollout.', at: at(180), rollbackAvailable: true, rollbackTestedAt: at(7200) } ] };
}
