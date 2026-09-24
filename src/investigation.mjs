import { chat, ModelError } from './model.mjs';
import { hybridRetrieve, validateAnalysis } from './intelligence.mjs';
import { digest, now } from './store.mjs';

const metrics = ['error_rate','latency_p95_ms','saturation','queue_depth','availability','replication_lag_s','certificate_days'];
const text = (s,n) => typeof s === 'string' && s.trim().length > 0 && s.length <= n;
const timestamp = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
const check = (yes,message) => { if (!yes) throw new Error(`Invalid evidence bundle: ${message}`); };
export function validateBundle(b, clock = Date.now()) {
  check(b && typeof b === 'object' && !Array.isArray(b), 'object required');
  check(timestamp(b.capturedAt) && clock-Date.parse(b.capturedAt) >= 0 && clock-Date.parse(b.capturedAt) <= 86400000, 'capture must be within the last 24 hours');
  check(text(b.source,300), 'source reference required');
  check(Array.isArray(b.services) && b.services.length > 0 && b.services.length <= 80, '1-80 services required');
  const ids = new Set();
  for (const s of b.services) { check(s && typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(s.id) && !ids.has(s.id) && text(s.owner,120) && ['critical','standard'].includes(s.tier), 'service ID, owner and tier required'); ids.add(s.id); }
  for (const s of b.services) check(Array.isArray(s.dependsOn) && s.dependsOn.length <= 30 && s.dependsOn.every(d => ids.has(d) && d !== s.id), 'dependency references must resolve');
  check(Array.isArray(b.signals) && b.signals.length > 0 && b.signals.length <= 120, '1-120 signals required');
  const signalIds = new Set();
  for (const s of b.signals) {
    check(s && text(s.id,60) && !signalIds.has(s.id) && ids.has(s.service) && metrics.includes(s.metric), 'unique signal ID, known service and metric required'); signalIds.add(s.id);
    check([s.before,s.after,s.limit].every(n => Number.isFinite(n) && n >= 0), 'finite nonnegative measurements required');
    check(timestamp(s.observedAt) && Date.parse(s.observedAt) <= Date.parse(b.capturedAt) && Date.parse(b.capturedAt)-Date.parse(s.observedAt) <= 86400000, 'signal timestamp outside capture window');
    if (['error_rate','saturation','availability'].includes(s.metric)) check([s.before,s.after,s.limit].every(n => n <= 1), 'rates must use 0-1 units');
  }
  check(Array.isArray(b.deployments) && b.deployments.length <= 80, 'deployment array required, maximum 80');
  const deploymentIds = new Set();
  for (const d of b.deployments) {
    check(d && text(d.id,60) && !deploymentIds.has(d.id) && ids.has(d.service) && text(d.revision,100) && text(d.description,600), 'unique deployment ID, service, revision and description required'); deploymentIds.add(d.id);
    check(timestamp(d.at) && Date.parse(d.at) <= Date.parse(b.capturedAt) && Date.parse(b.capturedAt)-Date.parse(d.at) <= 86400000, 'deployment timestamp outside capture window');
    check(typeof d.rollbackAvailable === 'boolean' && (d.rollbackTestedAt === null || (timestamp(d.rollbackTestedAt) && Date.parse(d.rollbackTestedAt) <= Date.parse(b.capturedAt))), 'rollback evidence required (null means unknown)');
  }
  // Normalize the contract: unknown fields cannot become covert model instructions.
  return { capturedAt: b.capturedAt, source: b.source, services: b.services.map(s => ({ id: s.id, owner: s.owner, tier: s.tier, dependsOn: [...new Set(s.dependsOn)] })), signals: b.signals.map(s => ({ id: s.id, service: s.service, metric: s.metric, before: s.before, after: s.after, limit: s.limit, observedAt: s.observedAt })), deployments: b.deployments.map(d => ({ id: d.id, service: d.service, revision: d.revision, description: d.description, at: d.at, rollbackAvailable: d.rollbackAvailable, rollbackTestedAt: d.rollbackTestedAt })) };
}
const breached = s => ['availability','certificate_days'].includes(s.metric) ? s.after < s.limit : s.after > s.limit;
export function dependencyImpact(bundle) {
  const roots = [...new Set(bundle.signals.filter(breached).map(s => s.service))];
  const affected = new Set(roots); let changed = true;
  while (changed) { changed = false; for (const s of bundle.services) if (!affected.has(s.id) && s.dependsOn.some(d => affected.has(d))) { affected.add(s.id); changed = true; } }
  return { roots, dependencies: bundle.services.map(s=>({service:s.id,dependsOn:s.dependsOn})), affected: bundle.services.filter(s => affected.has(s.id)).map(s => ({ service: s.id, owner: s.owner, tier: s.tier, reason: roots.includes(s.id) ? 'observed threshold breach' : 'potential transitive dependency impact' })) };
}
export function allowedImpact(bundle) {
  return Object.fromEntries(bundle.services.map(source=>{
    const seen=new Set([source.id]);let changed=true;
    while(changed){changed=false;for(const s of bundle.services)if(!seen.has(s.id)&&s.dependsOn.some(d=>seen.has(d))){seen.add(s.id);changed=true;}}
    return [source.id,[...seen]];
  }));
}
export function validateGrounding(analysis,bundle,evidence,observations) {
  const routes=allowedImpact(bundle);
  if (!Array.isArray(analysis?.hypotheses) || !analysis.hypotheses.length || analysis.hypotheses.length>3) throw new ModelError('Require 1-3 grounded hypotheses');
  return analysis.hypotheses.map(h=>{
    if (!h || typeof h.sourceService!=='string' || !Object.hasOwn(routes,h.sourceService) || !Array.isArray(h.affectedServices) || !h.affectedServices.length || h.affectedServices.length>80 || h.affectedServices.some(s=>!routes[h.sourceService].includes(s))) throw new ModelError('Model reversed or invented a dependency impact path');
    if (!text(h.mechanism,600) || !text(h.verification,600) || /\b(caused|proven|confirmed|definitely|resulted in|led to|root cause is)\b/i.test(h.mechanism) || /\b\d+(?:\.\d+)?\b/.test(h.mechanism)) throw new ModelError('Model mechanism contains certainty or unstructured numerical claims');
    if (!Array.isArray(h.observations) || !h.observations.length || h.observations.some(id=>!observations.some(e=>e.documentId===id)) || !Array.isArray(h.runbooks) || !h.runbooks.length || h.runbooks.some(id=>!evidence.some(e=>e.documentId===id))) throw new ModelError('Each hypothesis requires tool observations and retrieved runbook grounding');
    return {claim:`Unverified hypothesis: ${h.sourceService} may affect ${[...new Set(h.affectedServices)].join(', ')}. Possible mechanism: ${h.mechanism} Suggested read-only check: ${h.verification}`,citations:[...h.observations,...h.runbooks],sourceService:h.sourceService,affectedServices:[...new Set(h.affectedServices)],mechanism:h.mechanism,verification:h.verification};
  });
}
export const toolNames = ['dependency_impact','telemetry_compare','change_correlation','recovery_readiness'];
export function runTool(name,b) {
  if (name === 'dependency_impact') return dependencyImpact(b);
  if (name === 'telemetry_compare') return { observations: b.signals.map(s => ({ ...s, breached: breached(s), delta: s.after-s.before, relativeChange: s.before ? (s.after-s.before)/s.before : null })), note: 'Thresholds and before/after samples are caller-supplied, not statistically established SLO burn rates.' };
  if (name === 'change_correlation') return { candidates: b.signals.filter(breached).flatMap(s => b.deployments.filter(d => (d.service === s.service || b.services.find(x => x.id === s.service).dependsOn.includes(d.service)) && Date.parse(s.observedAt)-Date.parse(d.at) >= 0 && Date.parse(s.observedAt)-Date.parse(d.at) <= 900000).map(d => ({ signal: s.id, deployment: d.id, service: d.service, revision: d.revision, secondsBeforeSignal: (Date.parse(s.observedAt)-Date.parse(d.at))/1000 }))), limitation: '15-minute direct dependency correlation only; temporal proximity does not prove causation.' };
  if (name === 'recovery_readiness') return { deployments: b.deployments.map(d => ({ id: d.id, service: d.service, rollbackAvailable: d.rollbackAvailable, recentlyTested: d.rollbackTestedAt !== null && Date.parse(b.capturedAt)-Date.parse(d.rollbackTestedAt) <= 7*86400000, action: 'Human must verify recovery against the actual platform before any intervention.' })) };
  throw new ModelError('Agent requested a forbidden tool');
}
const planSchema = { type: 'object', required: ['reason','tools'], properties: { reason: { type: 'string' }, tools: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: toolNames } } } };
const reviewReasons=['consistent-with-provided-evidence','insufficient-evidence','unsupported-causality','unsupported-measurement','invalid-dependency'];
const reviewSchema = { type: 'object', required: ['checks'], properties: { checks: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', required: ['index','supported','reason'], properties: { index: { type: 'integer' }, supported: { type: 'boolean' }, reason: { type: 'string',enum:reviewReasons } } } } } };

export async function investigateBundle(c, store, config) {
  const started = performance.now(); const b = validateBundle(c.bundle);
  c.trace = []; c.progress = 'planning'; store.save(c);
  const plan = await chat(config, 'Plan a bounded read-only operational investigation. Select tools from dependency_impact, telemetry_compare, change_correlation, recovery_readiness. Return {reason:string,tools:[names]}. Dependency and telemetry checks always run; select additional tools needed to investigate the incident. The reason must describe intended checks, NOT diagnose a cause before tools run. Keep the reason below 25 words.', { title: c.title, services: b.services, signals: b.signals, deployments: b.deployments }, planSchema,250);
  if (!text(plan?.reason,1500) || !Array.isArray(plan.tools) || !plan.tools.length || plan.tools.length > 4 || !plan.tools.every(n => toolNames.includes(n))) throw new ModelError('Invalid agent plan or forbidden tool');
  c.plan = { reason: plan.reason, tools: [...new Set(['dependency_impact','telemetry_compare',...plan.tools])] };
  c.progress = 'collecting'; store.save(c);
  for (const tool of c.plan.tools) {
    const result = runTool(tool,b);
    c.trace.push({ tool, at: now(), inputDigest: digest(b), outputDigest: digest(result), result });
  }
  c.impact = dependencyImpact(b);
  c.risk = c.impact.affected.some(s => s.tier === 'critical') ? 'critical-review' : c.impact.roots.length ? 'review' : 'insufficient-signal';
  c.progress = 'retrieving'; store.save(c);
  c.evidence = await hybridRetrieve(store,c.tenant,`${c.title} ${b.signals.map(s => s.metric).join(' ')} ${b.services.map(s => s.id).join(' ')} recovery deployment dependencies`,config);
  const observations = c.trace.map(x => ({ documentId: `tool:${x.tool}`, text: JSON.stringify(x.result) }));
  const evidence = [...c.evidence.map(e => ({ documentId:e.documentId,title:e.title,text:e.text })),...observations];
  c.progress = 'synthesizing'; store.save(c);
  const services=b.services.map(s=>s.id);
  const groundingSchema = { type:'object',required:['hypotheses'],properties:{hypotheses:{type:'array',minItems:1,maxItems:3,items:{type:'object',required:['sourceService','affectedServices','mechanism','verification','observations','runbooks'],properties:{sourceService:{type:'string',enum:services},affectedServices:{type:'array',minItems:1,maxItems:5,items:{type:'string',enum:services}},mechanism:{type:'string'},verification:{type:'string'},observations:{type:'array',minItems:1,maxItems:4,items:{type:'string',enum:observations.map(e=>e.documentId)}},runbooks:{type:'array',minItems:1,maxItems:3,items:{type:'string',enum:[...new Set(c.evidence.map(e=>e.documentId))]}}}}}}};
  const analysis = await chat(config, 'Synthesize 1-2 concise unverified hypotheses. For each choose sourceService, affectedServices FROM THAT SOURCE IN allowedImpact, mechanism, verification (a read-only follow-up check), observations (tool IDs), runbooks (runbook IDs). Mechanism must express a possibility, never a confirmed cause, and contain NO numerical claims; the application reports measurements directly. Do not reverse dependency direction. A database may affect its checkout consumer; checkout does not thereby affect the database. Keep mechanism and verification each below 35 words. Cite at least one relevant tool and one runbook for EACH hypothesis.', { title: c.title, allowedImpact:allowedImpact(b), evidence },groundingSchema,900);
  const grounded=validateGrounding(analysis,b,c.evidence,observations);
  const summary=`${b.signals.filter(breached).length} threshold breaches in supplied signals; ${c.impact.affected.length} services in the observed or potential impact set. ${grounded.length} unverified hypotheses require operator investigation. No causality is established.`;
  c.analysis = { provider: 'configured-model', model: config.llm.model, ...validateAnalysis({summary,hypotheses:grounded},evidence), structuredHypotheses:grounded, limitation: 'Read-only hypotheses; not proven RCA, an execution plan, or a compliance determination. Summary measurements and impact paths are calculated, not model-generated.' };
  const ids = c.analysis.hypotheses.flatMap(h => h.citations);
  if (!ids.some(id => id.startsWith('tool:')) || !ids.some(id => c.evidence.some(e => e.documentId === id))) throw new ModelError('Analysis must ground findings in both tools and retrieved runbooks');
  c.progress = 'verifying'; store.save(c);
  const review = await chat(config, 'Act as a skeptical evidence reviewer. For EVERY hypothesis, check whether the cited evidence supports it as a POSSIBILITY, not proven cause. Return {checks:[{index:0,supported:true,reason:code}]}; zero-based indexes. Allowed reason codes: consistent-with-provided-evidence, insufficient-evidence, unsupported-causality, unsupported-measurement, invalid-dependency. Only the first code permits supported:true. Do not invent missing metrics or produce prose. A correct citation ID alone is not enough.', { hypotheses: c.analysis.hypotheses, evidence },reviewSchema,220);
  if (!Array.isArray(review?.checks) || review.checks.length !== c.analysis.hypotheses.length || new Set(review.checks.map(x => x?.index)).size !== c.analysis.hypotheses.length || review.checks.some(x => !Number.isInteger(x?.index) || x.index < 0 || x.index >= c.analysis.hypotheses.length || typeof x.supported !== 'boolean' || !reviewReasons.includes(x.reason) || x.supported !== (x.reason==='consistent-with-provided-evidence'))) throw new ModelError('Invalid skeptical review');
  c.review = review;
  if (review.checks.some(x => !x.supported)) throw new ModelError('Skeptical review found unsupported claims; operator review required');
  validateBundle(c.bundle); // Long inference cannot turn stale input into current evidence.
  c.progress = 'complete'; c.timings = { totalMs: Math.round(performance.now()-started), modelCalls: 3, toolCalls: c.trace.length };
  c.nextSteps = ['Verify the cited signals against the source monitoring system.', 'Contact the listed service owners to confirm dependency impact.', 'Reproduce the suspected change in a representative non-production environment.', 'Use your approved change process; this assessment cannot execute production actions.'];
}
