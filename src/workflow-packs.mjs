// Host-owned procedures. Event data and model output cannot add steps or permissions.
export const packs = {
  'transaction-recovery': {
    title: 'Business transaction recovery', domain: 'Business operations',
    objective: 'Recover a paid order with a missing reservation and fulfillment handoff.',
    roles: ['payment', 'inventory', 'fulfillment'],
    graph: [['payment','inventory'],['inventory','fulfillment']],
    guards: { payment: { status: 'paid' } },
    steps: [
      { role: 'inventory', from: { status: 'available' }, to: { status: 'reserved' } },
      { role: 'fulfillment', from: { status: 'blocked' }, to: { status: 'queued' } }
    ],
    procedure: 'Verify payment is paid before changing inventory. Reserve available inventory before queuing fulfillment. Never issue another charge. Re-read all systems to verify payment remains paid, inventory reserved and fulfillment queued. On failure compensate only writes owned by this workflow, in reverse order, using revision checks. A dispatched shipment or externally changed reservation requires human reconciliation.'
  },
  'technology-recovery': {
    title: 'Technology incident recovery', domain: 'Technology operations',
    objective: 'Restore an approved deployment release and reconcile its traffic route.',
    roles: ['release', 'deployment', 'routing'],
    graph: [['release','deployment'],['deployment','routing']],
    guards: { release: { status: 'approved', recovery: 'tested' } },
    steps: [
      { role: 'deployment', from: { status: 'degraded' }, to: { status: 'restored' } },
      { role: 'routing', from: { status: 'stale' }, to: { status: 'reconciled' } }
    ],
    procedure: 'Require the release system to confirm an approved, tested recovery. Restore the deployment through the bounded adapter operation, then reconcile routing. Verify release authorization, deployment restoration and routing together. Do not execute shell commands or infer health from an action acknowledgment. Compensate only revision-matched writes; escalate if recovery or routing changed externally.'
  },
  'access-reconciliation': {
    title: 'Employee access reconciliation', domain: 'Access and governance',
    objective: 'Reconcile an active employee account and its approved standard access.',
    roles: ['hr', 'directory', 'entitlement'],
    graph: [['hr','directory'],['directory','entitlement']],
    guards: { hr: { status: 'active', access: 'standard-approved' } },
    steps: [
      { role: 'directory', from: { status: 'disabled' }, to: { status: 'enabled' } },
      { role: 'entitlement', from: { status: 'missing' }, to: { status: 'standard' } }
    ],
    procedure: 'Verify active employment and explicit standard-access approval from HR. Enable the existing account, then apply only the predefined standard entitlement. Never infer or grant administrator access. Verify HR remains active and approved, account enabled and entitlement standard. Revoke only workflow-owned grants during compensation; concurrent changes require human review.'
  }
};
export const workflowPolicy = 'cross-system-v1';
export const matches = (data, expected) => Object.entries(expected).every(([key,value]) => data?.[key] === value);
export function registry(custom=[]) {
  if(!Array.isArray(custom)||custom.length>20)throw new Error('Configure at most 20 custom workflow packs');
  const result=Object.assign(Object.create(null),packs);
  const id=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,60}$/.test(s);
  const condition=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length>0&&Object.keys(x).length<=8&&Object.entries(x).every(([k,v])=>id(k)&&!['__proto__','prototype','constructor'].includes(k)&&(typeof v==='boolean'||typeof v==='string'&&v.length<=100||Number.isFinite(v)));
  for(const p of custom){
    if(!p||!id(p.id)||result[p.id]||![p.title,p.domain,p.objective,p.procedure].every(s=>typeof s==='string'&&s.trim()&&s.length<=2000)||!Array.isArray(p.roles)||p.roles.length<2||p.roles.length>12||new Set(p.roles).size!==p.roles.length||p.roles.some(r=>!id(r)||['__proto__','prototype','constructor'].includes(r)))throw new Error('Invalid custom workflow pack identity or roles');
    if(!p.guards||!Object.keys(p.guards).length||Object.entries(p.guards).some(([r,v])=>!p.roles.includes(r)||!condition(v))||!Array.isArray(p.steps)||!p.steps.length||p.steps.length>12||new Set(p.steps.map(s=>s?.role)).size!==p.steps.length||p.steps.some(s=>!s||!p.roles.includes(s.role)||Object.hasOwn(p.guards,s.role)||!condition(s.from)||!condition(s.to)||JSON.stringify(Object.keys(s.from).sort())!==JSON.stringify(Object.keys(s.to).sort())))throw new Error('Invalid custom workflow guards or transitions');
    if(p.roles.some(r=>!Object.hasOwn(p.guards,r)&&!p.steps.some(s=>s.role===r))||!Array.isArray(p.graph)||p.graph.some(e=>!Array.isArray(e)||e.length!==2||e.some(r=>!p.roles.includes(r))))throw new Error('Invalid custom workflow graph');
    const order=[...Object.keys(p.guards),...p.steps.map(s=>s.role)];if(p.graph.some(([a,b])=>order.indexOf(a)>=order.indexOf(b)))throw new Error('Workflow graph must follow guard-first step order without cycles');
    result[p.id]=JSON.parse(JSON.stringify(p));
  }
  return result;
}
export function catalog(values=packs) { return Object.entries(values).map(([id,p])=>({id,title:p.title,domain:p.domain,objective:p.objective,roles:p.roles,graph:p.graph,steps:p.steps})); }
