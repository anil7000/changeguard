import { validateBundle } from './investigation.mjs';

export class ConnectorError extends Error { constructor(message,retryable=false) { super(message);this.retryable=retryable; } }
const requireValue=(ok,message)=>{if(!ok)throw new ConnectorError(message);};
const id=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,60}$/.test(value);
const metrics=['error_rate','latency_p95_ms','saturation','queue_depth','availability','replication_lag_s','certificate_days'];

// Trust is a host-operator decision. Browser admins cannot authorize new network origins or read arbitrary secrets.
export function trustedSource(config,tenant,endpoint) {
  let url;try{url=new URL(endpoint);}catch{throw new ConnectorError('Invalid endpoint URL');}
  requireValue(['http:','https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,'Endpoint must be an HTTP(S) URL without credentials, query or fragment');
  requireValue(!['169.254.169.254','169.254.170.2','metadata.google.internal','metadata'].includes(url.hostname),'Cloud metadata endpoints are forbidden');
  const trust=(config.connectorOrigins??[]).find(t=>t.tenant===tenant && t.origin===url.origin);
  requireValue(trust,'Endpoint origin is not authorized for this tenant by the host operator');
  if(trust.secretEnv)requireValue(/^CG_SOURCE_[A-Z0-9_]{1,80}$/.test(trust.secretEnv),'Source credential must use a CG_SOURCE_ environment reference');
  if(trust.secretEnv)requireValue(url.protocol==='https:' || ['127.0.0.1','[::1]'].includes(url.hostname),'Source credentials require HTTPS outside exact loopback addresses');
  return {url,trust};
}

export function validateConnection(input,config,tenant) {
  requireValue(input && id(input.id) && id(input.environment),'Connection ID and environment must be 1-60 safe characters');
  requireValue(input.type==='prometheus','Supported collector type: prometheus');
  const {url}=trustedSource(config,tenant,input.endpoint);
  requireValue(typeof input.enabled==='boolean','Enabled must be boolean');
  requireValue(Number.isInteger(input.intervalSeconds) && (input.intervalSeconds===0 || input.intervalSeconds>=60 && input.intervalSeconds<=86400),'Schedule must be disabled (0) or 60-86400 seconds');
  requireValue(Number.isInteger(input.baselineMinutes) && input.baselineMinutes>=1 && input.baselineMinutes<=1440,'Baseline must be 1-1440 minutes');
  requireValue(['always','on-breach'].includes(input.mode),'Investigation mode must be always or on-breach');
  requireValue(typeof input.question==='string' && input.question.trim().length>0 && input.question.length<=180,'Question must be 1-180 characters');
  requireValue(Array.isArray(input.queries) && input.queries.length>=1 && input.queries.length<=12,'Configure 1-12 metric queries');
  const signalIds=new Set();
  for(const q of input.queries){
    requireValue(q && id(q.id) && !signalIds.has(q.id) && id(q.service) && metrics.includes(q.metric),'Each query requires a unique ID, service and supported metric');signalIds.add(q.id);
    requireValue(typeof q.expression==='string' && q.expression.trim().length>0 && q.expression.length<=2000,'PromQL expression must be 1-2000 characters');
    requireValue(Number.isFinite(q.limit) && q.limit>=0,'Metric threshold must be finite and nonnegative');
  }
  const at=new Date().toISOString();
  const sample={capturedAt:at,source:'connection validation',services:input.services,signals:input.queries.map(q=>({id:q.id,service:q.service,metric:q.metric,before:0,after:0,limit:q.limit,observedAt:at})),deployments:[]};
  let services;try{services=validateBundle(sample).services;}catch(e){throw new ConnectorError(e.message);}
  return {id:input.id,type:'prometheus',environment:input.environment,endpoint:url.href.replace(/\/$/,''),enabled:input.enabled,intervalSeconds:input.intervalSeconds,baselineMinutes:input.baselineMinutes,mode:input.mode,question:input.question.trim(),services,queries:input.queries.map(q=>({id:q.id,service:q.service,metric:q.metric,limit:q.limit,expression:q.expression.trim()}))};
}

async function readJson(response) {
  if(!response.ok){await response.body?.cancel();throw new ConnectorError(`Source returned HTTP ${response.status}`,response.status===429 || response.status>=500);}
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>1024*1024)throw new ConnectorError('Source response exceeds 1 MiB');parts.push(part);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new ConnectorError('Source did not return JSON');}
}

export function parseSample(data,time) {
  requireValue(data?.status==='success' && !data.warnings?.length,'Prometheus query failed or reported partial-result warnings');
  let value;
  if(data.data?.resultType==='scalar')value=data.data.result;
  else if(data.data?.resultType==='vector' && data.data.result?.length===1)value=data.data.result[0].value;
  requireValue(Array.isArray(value) && value.length===2 && typeof value[0]==='number' && Math.abs(value[0]-time)<=120,'Query must return exactly one fresh scalar or vector sample');
  requireValue(typeof value[1]==='string' && value[1].trim()!=='' && Number.isFinite(Number(value[1])) && Number(value[1])>=0,'Query returned missing, negative or non-finite data');
  return Number(value[1]);
}

export async function collectPrometheus(connection,config,tenant,deployments=[],fetcher=fetch) {
  const c=validateConnection(connection,config,tenant);const {url,trust}=trustedSource(config,tenant,c.endpoint);
  const headers={accept:'application/json'};
  if(trust.secretEnv){const secret=process.env[trust.secretEnv];requireValue(secret && !/[\r\n]/.test(secret),'Configured source credential is unavailable');headers.authorization=`Bearer ${secret}`;}
  const capturedAt=new Date().toISOString();const current=Math.floor(Date.parse(capturedAt)/1000);const previous=current-c.baselineMinutes*60;
  const total=AbortSignal.timeout(60000);
  async function query(q,time){
    const target=new URL(url);target.pathname=target.pathname.replace(/\/$/,'')+'/api/v1/query';target.search=new URLSearchParams({query:q.expression,time:String(time),timeout:'8s'}).toString();
    try {const response=await fetcher(target,{headers,redirect:'error',signal:AbortSignal.any([total,AbortSignal.timeout(10000)])});return parseSample(await readJson(response),time);}
    catch(e){if(e instanceof ConnectorError)throw e;throw new ConnectorError('Source unavailable, timed out or redirected',true);}
  }
  const signals=[];
  // At most four outgoing requests in flight. Partial collections are never analyzed.
  for(let offset=0;offset<c.queries.length;offset+=2){
    const chunk=await Promise.all(c.queries.slice(offset,offset+2).map(async q=>{const [before,after]=await Promise.all([query(q,previous),query(q,current)]);return {id:q.id,service:q.service,metric:q.metric,before,after,limit:q.limit,observedAt:new Date(current*1000).toISOString()};}));signals.push(...chunk);
  }
  try{return validateBundle({capturedAt,source:`prometheus:${c.id}; environment:${c.environment}; baseline:${c.baselineMinutes}m`,services:c.services,signals,deployments:deployments.filter(d=>c.services.some(s=>s.id===d.service) && Date.parse(d.at)<=Date.parse(capturedAt))});}
  catch(e){throw new ConnectorError(e.message);}
}

export const hasBreach=bundle=>bundle.signals.some(s=>['availability','certificate_days'].includes(s.metric)?s.after<s.limit:s.after>s.limit);

export function alertEvent(payload) {
  requireValue(payload && payload.version==='4' && ['firing','resolved'].includes(payload.status) && Array.isArray(payload.alerts) && payload.alerts.length>=1 && payload.alerts.length<=100,'Expected Alertmanager v4 payload with 1-100 alerts');
  requireValue(!payload.truncatedAlerts,'Truncated alert groups must be narrowed at the sender');
  const events=payload.alerts.map(a=>{
    requireValue(a && ['firing','resolved'].includes(a.status) && typeof a.fingerprint==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(a.fingerprint),'Alert fingerprint and status required');
    requireValue(typeof a.startsAt==='string' && Number.isFinite(Date.parse(a.startsAt)) && Date.parse(a.startsAt)<=Date.now(),'Invalid alert start timestamp');
    return {fingerprint:a.fingerprint,startsAt:new Date(a.startsAt).toISOString(),status:a.status};
  }).sort((a,b)=>`${a.fingerprint}/${a.startsAt}/${a.status}`.localeCompare(`${b.fingerprint}/${b.startsAt}/${b.status}`));
  // Alert labels, annotations and generator URLs never select destinations, credentials or tools.
  return {status:payload.status,events};
}
