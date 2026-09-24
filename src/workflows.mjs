import { digest, now, uid } from './store.mjs';
import { fail } from './engine.mjs';
import { registry, catalog, matches, workflowPolicy } from './workflow-packs.mjs';
import { WorkflowAdapter } from './workflow-adapter.mjs';
import { hybridRetrieve } from './intelligence.mjs';
import { chat } from './model.mjs';
import { trustedSource } from './connectors.mjs';
import { WorkflowDelivery } from './workflow-delivery.mjs';

const safe = value => typeof value==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const terminal = new Set(['COMPLETED','COMPENSATED','CANCELLED']);
const schema={type:'object',additionalProperties:false,required:['summary','recommendation','citations'],properties:{summary:{type:'string'},recommendation:{type:'string',enum:['execute','escalate']},citations:{type:'array',items:{type:'string'},minItems:1,maxItems:10}}};
const reviewSchema = {
  type: 'object', additionalProperties: false, required: ['checks'],
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['role', 'allowed', 'reason'],
        properties: { role: { type: 'string' }, allowed: { type: 'boolean' }, reason: { type: 'string' } }
      }
    }
  }
};

export class Workflows {
  constructor(store,config,{adapter=(tenant,b)=>new WorkflowAdapter(config,tenant,b),model=chat,retrieve=hybridRetrieve}={}) {
    this.store=store;this.config=config;this.adapter=adapter;this.model=model;this.retrieve=retrieve;this.jobs=new Map();this.stopped=false;
    this.packs=registry(config.workflowPacks);
    this.delivery=new WorkflowDelivery(store,config);this.nextSchedule=0;
    for(const b of config.workflowBindings??[])this.validateBinding(b);
  }
  validateBinding(b) {
    if(!b || !safe(b.id) || !safe(b.tenant) || !safe(b.environment) || !this.packs[b.pack] || !['approval','automatic'].includes(b.mode) || typeof b.enabled!=='boolean' || !safe(b.resourcePrefix) || !Array.isArray(b.procedureIds) || !b.procedureIds.length || b.procedureIds.length>10 || b.procedureIds.some(id=>!safe(id)))throw new Error('Invalid workflow binding');
    for(const role of this.packs[b.pack].roles)trustedSource(this.config,b.tenant,b.adapters?.[role]?.endpoint);
    if(b.notificationEndpoint)trustedSource(this.config,b.tenant,b.notificationEndpoint);
    if(b.initiators && (!Array.isArray(b.initiators)||!b.initiators.length||b.initiators.some(id=>!safe(id)||!this.config.users.some(u=>u.tenant===b.tenant&&u.id===id&&u.roles.some(r=>['operator','collector'].includes(r))))))throw new Error('Invalid workflow initiator scope');
    if(b.reconcile && (!Number.isInteger(b.reconcile.intervalSeconds) || b.reconcile.intervalSeconds<60 || b.reconcile.intervalSeconds>86400 || !Array.isArray(b.reconcile.resources) || !b.reconcile.resources.length || b.reconcile.resources.length>20 || b.reconcile.resources.some(r=>!safe(r)||!r.startsWith(b.resourcePrefix)) || !this.config.users.some(u=>u.tenant===b.tenant && u.id===b.reconcile.identity && u.roles.includes('collector'))))throw new Error('Invalid scheduled reconciliation configuration');
    if((this.config.workflowBindings??[]).filter(x=>x.tenant===b.tenant && x.id===b.id).length!==1)throw new Error('Duplicate workflow binding');
  }
  bindings(tenant) { return (this.config.workflowBindings??[]).filter(b=>b.tenant===tenant).map(({id,pack,environment,mode,enabled,resourcePrefix})=>({id,pack,environment,mode,enabled,resourcePrefix})); }
  catalog(tenant) { const allowed=new Set(this.bindings(tenant).map(b=>b.pack));return catalog(this.packs).filter(p=>Object.hasOwn(registry(),p.id)||allowed.has(p.id)); }
  binding(c) { const b=(this.config.workflowBindings??[]).find(b=>b.tenant===c.tenant && b.id===c.binding);if(!b?.enabled)fail(409,'Workflow binding disabled or unavailable');return b; }
  current(user,id) { const c=this.store.workflow(user.tenant,id);if(!c)fail(404,'Workflow not found');return c; }
  save(c,event,actor='workflow-worker') {
    this.store.transaction(()=>{
      this.store.saveWorkflow(c);this.store.audit(c.tenant,actor,event,{workflowId:c.id,state:c.state,reason:c.reason});if(terminal.has(c.state))this.store.unlockWorkflow(c);
      const b=(this.config.workflowBindings??[]).find(b=>b.tenant===c.tenant&&b.id===c.binding);
      if(b?.notificationEndpoint && ['REVIEW','HELD','COMPLETED','COMPENSATED','CANCELLED'].includes(c.state)){
        const id=digest([c.id,event,c.updatedAt]);this.store.putDelivery({id,tenant:c.tenant,binding:c.binding,endpoint:b.notificationEndpoint,state:'PENDING',attempts:0,nextAt:now(),payload:{id,event,state:c.state,workflowId:c.id,resource:c.resource,source:c.source,externalId:c.externalId,reason:c.reason,detailPath:'/#workflow='+c.id}});
      }
    });return c;
  }
  submit(user,input,key) {
    if(!user.roles.some(r=>['operator','collector'].includes(r)))fail(403,'operator or collector role required');
    if(!safe(key) || key.length<8)fail(400,'Idempotency-Key must be 8-100 safe characters');
    if(!input || !safe(input.binding) || !safe(input.resource) || !['event','ticket','chat','schedule','manual','cicd'].includes(input.source) || !safe(input.externalId) || typeof input.summary!=='string' || !input.summary.trim() || input.summary.length>500)fail(400,'Binding, resource, source, externalId and summary are required');
    const data={binding:input.binding,resource:input.resource,source:input.source,externalId:input.externalId,summary:input.summary.trim()};const hash=digest(data);
    const allowed=this.binding({...data,tenant:user.tenant});
    if(allowed.initiators && !allowed.initiators.includes(user.id))fail(403,'Identity cannot trigger this workflow binding');
    const existing=this.store.workflowKey(user.tenant,key);
    if(existing){if(existing.request_hash!==hash)fail(409,'Idempotency key reused with different event');return this.store.workflow(user.tenant,existing.id);}
    const event=this.store.workflowEvent(user.tenant,data);
    if(event){if(event.request_hash!==hash)fail(409,'Source event identity reused with different content');return this.store.workflow(user.tenant,event.id);}
    const c={...data,id:uid(),tenant:user.tenant,requester:user.id,state:'QUEUED',createdAt:now(),updatedAt:now(),policy:workflowPolicy,receipts:[],compensations:[],trace:[]};
    const b=this.binding(c);if(!c.resource.startsWith(b.resourcePrefix))fail(403,'Resource outside binding scope');
    if(this.config.workflowPaused)fail(409,'Workflow execution paused');
    if(this.store.workflowCount(user.tenant)>=20)fail(429,'Tenant workflow quota reached; resolve held work first');
    c.pack=b.pack;c.environment=b.environment;c.bindingDigest=digest(b);c.packDigest=digest(this.packs[b.pack]);
    this.store.transaction(()=>{this.store.insertWorkflow(c,key,hash);this.store.audit(c.tenant,user.id,'workflow-submitted',{workflowId:c.id,pack:c.pack,source:c.source,externalId:c.externalId});});return c;
  }
  policy(c,{approval=false,evidence=false}={}) {
    if(this.config.workflowPaused)fail(409,'Workflow execution paused');
    const b=this.binding(c);
    if(c.bindingDigest!==digest(b) || c.policy!==workflowPolicy || c.packDigest!==digest(this.packs[c.pack]))fail(409,'Workflow binding or policy changed');
    if(!this.config.users.some(u=>u.tenant===c.tenant && u.id===c.requester && u.roles.some(r=>['operator','collector'].includes(r))))fail(403,'Requester authority revoked');
    if(b.initiators && !b.initiators.includes(c.requester))fail(403,'Workflow initiator scope revoked');
    if(evidence && (!c.evidence?.length || c.evidence.some(e=>{const d=this.store.doc(c.tenant,e.documentId);return !d || d.digest!==e.digest || !(Date.parse(d.expiresAt)>Date.now());})))fail(409,'Knowledge expired or changed; human review required');
    if(approval && b.mode==='approval' && (!c.approval || c.approval.actor===c.requester || c.approval.planDigest!==digest(c.plan) || !(Date.parse(c.approval.expiresAt)>Date.now()) || !this.config.users.some(u=>u.tenant===c.tenant && u.id===c.approval.actor && u.roles.includes('approver'))))fail(409,'Independent current approval required');
    return b;
  }
  async snapshots(c) {
    const b=this.binding(c);const result={};
    for(const role of this.packs[c.pack].roles)result[role]=await this.adapter(c.tenant,b.adapters[role]).read(c.resource);
    return result;
  }
  validGuards(c,snapshots) { return Object.entries(this.packs[c.pack].guards).every(([role,expected])=>matches(snapshots[role]?.data,expected)); }
  expected(c) { const p=this.packs[c.pack];return {...p.guards,...Object.fromEntries(p.steps.map(s=>[s.role,s.to]))}; }
  async investigate(c) {
    const b=this.policy(c);const p=this.packs[c.pack];
    this.store.transaction(()=>this.store.lockWorkflow(c,p.roles.map(role=>digest([b.adapters[role].endpoint,c.resource]))));
    c.state='INVESTIGATING';this.save(c,'workflow-investigating');
    c.snapshots=await this.snapshots(c);
    if(!this.validGuards(c,c.snapshots))fail(409,'Authoritative business prerequisite not satisfied; no actions permitted');
    c.plan=[];
    for(const step of p.steps){const snap=c.snapshots[step.role];if(matches(snap.data,step.to))continue;if(!matches(snap.data,step.from))fail(409,`Unsupported ${step.role} state; human reconciliation required`);c.plan.push({...step,expectedVersion:snap.version});}
    c.evidence=await this.retrieve(this.store,c.tenant,`${p.title} ${p.objective} ${c.summary}`,this.config,{documentIds:b.procedureIds});
    // Only declared state fields enter the model context. Adapter payloads may contain sensitive unrelated fields.
    const observations=Object.fromEntries(p.roles.map(role=>[role,{version:c.snapshots[role].version,state:Object.fromEntries(Object.keys(this.expected(c)[role]).map(k=>[k,c.snapshots[role].data[k]]))}]));
    const executionContract={phase:'before-execution',guards:p.guards,guardsRecheckedBeforeEachWrite:true,targetRevisionCheckedByAdapter:true,postconditions:this.expected(c),postconditionsCheckedAfterAllWrites:true,compensation:'Reverse only workflow-owned writes using receipt revisions; a conflicting revision escalates to human review.',authorization:b.mode==='approval'?'Independent human approval required after model review':'Host-configured automatic policy; model output grants no authority'};
    const scopedSchema={...schema,properties:{...schema.properties,citations:{...schema.properties.citations,items:{type:'string',enum:[...new Set(c.evidence.map(e=>e.documentId))]}}}};
    c.analysis=await this.model(this.config,'Investigate a cross-system operational failure. Evaluate this fixed recovery plan against observations, the enforced execution contract and retrieved procedures. Recommend execute only when evidence supports eligibility for the plan; otherwise escalate. Citations must contain exact documentId values with no prefixes. You cannot create or alter actions. This is a pre-execution review; future postconditions are checked by the engine after execution, not claimed as already achieved.',{objective:p.objective,event:c.summary,observations,executionContract,plan:c.plan,evidence:c.evidence.map(e=>({documentId:e.documentId,text:e.text}))},scopedSchema,600);
    const a=c.analysis;
    if(!a || typeof a.summary!=='string' || !a.summary.trim() || a.summary.length>3000 || !['execute','escalate'].includes(a.recommendation) || !Array.isArray(a.citations) || !a.citations.length || !a.citations.every(id=>c.evidence.some(e=>e.documentId===id)))fail(409,'Invalid model recommendation or citation');
    const reviewRoles=c.plan.length?c.plan.map(s=>s.role):['verification'];
    const stepReviewSchema={...reviewSchema,properties:{checks:{...reviewSchema.properties.checks,minItems:reviewRoles.length,maxItems:reviewRoles.length,items:{...reviewSchema.properties.checks.items,properties:{...reviewSchema.properties.checks.items.properties,role:{type:'string',enum:reviewRoles}}}}}};
    const reviewed=await this.model(this.config,'Review the proposed cross-system recovery procedure one transition at a time. For each role, decide whether its proposed from-to transition is allowed by the cited procedure given the supplied current preconditions. This is a BEFORE-execution procedure-conformance check, not an AFTER-execution outcome check. Future target states are expected to differ from current states: that is the purpose of a recovery action. Reject an action absent from or contrary to the procedure. Return one check per reviewRoles entry. If verification is the only role, assess whether a read-only outcome check is appropriate. Your classification cannot authorize execution; the engine independently enforces policy, guards, revision checks, compensation and later outcome verification.',{reviewRoles,currentPreconditions:observations,proposedTransitions:c.plan.map((s,i)=>({...s,step:i+1,expectedAfterVersion:s.expectedVersion+1,requiresAllPreviousStepsVerified:true})),engineSafeguards:executionContract,evidence:c.evidence.map(e=>({documentId:e.documentId,text:e.text}))},stepReviewSchema,600);
    if(!Array.isArray(reviewed?.checks)||reviewed.checks.length!==reviewRoles.length||new Set(reviewed.checks.map(x=>x?.role)).size!==reviewRoles.length||reviewed.checks.some(x=>!reviewRoles.includes(x?.role)||typeof x.allowed!=='boolean'||typeof x.reason!=='string'||!x.reason.trim()||x.reason.length>1500))fail(409,'Invalid independent model review');
    c.review={supported:reviewed.checks.every(x=>x.allowed),reason:reviewed.checks.map(x=>`${x.role}: ${x.reason}`).join(' '),checks:reviewed.checks};
    this.policy(c,{evidence:true});
    if(a.recommendation==='escalate' || !c.review.supported)fail(409,'Agent investigation requires human judgment');
    c.investigatedAt=now();c.trace.push({at:now(),stage:'investigation',roles:p.roles,citations:a.citations,model:this.config.llm?.model});
    c.state=b.mode==='approval' && c.plan.length?'REVIEW':'EXECUTING';c.reason=c.state==='REVIEW'?'Independent approval required for this exact plan':'Policy permits bounded execution';this.save(c,'workflow-planned');
  }
  approve(user,id) {
    if(!user.roles.includes('approver'))fail(403,'approver role required');const c=this.current(user,id);
    if(c.state!=='REVIEW')fail(409,'Workflow is not awaiting approval');if(c.requester===user.id)fail(403,'Requester cannot approve own workflow');
    this.policy(c,{evidence:true});c.approval={actor:user.id,planDigest:digest(c.plan),expiresAt:new Date(Date.now()+900000).toISOString()};c.state='EXECUTING';c.reason='Independent approval recorded';return this.save(c,'workflow-approved',user.id);
  }
  cancel(user,id) {
    if(!user.roles.includes('operator'))fail(403,'operator role required');const c=this.current(user,id);
    if(!['QUEUED','REVIEW','HELD'].includes(c.state) || c.intent || c.receipts.length)fail(409,'Cannot cancel work with possible external effects');
    c.state='CANCELLED';c.reason='Cancelled before external effects';return this.save(c,'workflow-cancelled',user.id);
  }
  resume(user,id) {
    if(!user.roles.includes('operator'))fail(403,'operator role required');const c=this.current(user,id);
    if(c.state!=='HELD')fail(409,'Only held workflows can be resumed');
    this.policy(c);c.retries=0;delete c.retryAt;c.state=c.intent?.kind==='compensate' || c.compensating?'COMPENSATING':c.intent || c.receipts.length?'EXECUTING':'QUEUED';c.reason='Operator requested reconciliation';return this.save(c,'workflow-resumed',user.id);
  }
  validateReceipt(c,intent,r) {
    if(!r || r.id!==intent.id || r.resource!==c.resource || r.requestDigest!==digest(intent) || r.status!=='applied' || !Number.isSafeInteger(r.version) || r.version!==intent.expectedVersion+1 || !matches(r.data,intent.to))fail(409,'Action receipt does not match durable intent');
    return r;
  }
  async perform(c,intent) {
    const b=this.binding(c);const adapter=this.adapter(c.tenant,b.adapters[intent.role]);
    // Persist intent before crossing the process boundary. Reconcile any prior effect first.
    c.intent=intent;this.save(c,'workflow-action-intent');
    let receipt=await adapter.receipt(intent.id);
    if(!receipt){
      this.policy(c,{approval:intent.kind!=='compensate',evidence:true});
      if(intent.kind==='apply'){
        const snapshots=await this.snapshots(c);
        if(!this.validGuards(c,snapshots))fail(409,'Business authority changed before action');
        if(snapshots[intent.role].version!==intent.expectedVersion || !matches(snapshots[intent.role].data,intent.from))fail(409,'Target drift before action');
      }
      this.policy(c,{approval:intent.kind!=='compensate',evidence:true});
      try{receipt=await adapter.apply(intent);}catch(e){
        // Contract: HTTP 409 guarantees this intent was rejected without an effect.
        if(e.status===409 && intent.kind==='apply'){delete c.intent;e.actionRejected=true;this.save(c,'workflow-action-rejected');}
        throw e;
      }
    }
    return this.validateReceipt(c,intent,receipt);
  }
  async execute(c) {
    // Reconcile a persisted uncertain write even when approval expired, but never issue a new write without policy.
    if(c.intent){const r=await this.perform(c,c.intent);c.receipts.push({intent:c.intent,receipt:r});delete c.intent;this.save(c,'workflow-action-reconciled');}
    this.policy(c,{approval:c.plan.length>0,evidence:true});
    for(let index=c.receipts.length;index<c.plan.length;index++){
      const step=c.plan[index];const snapshots=await this.snapshots(c);
      if(!this.validGuards(c,snapshots))fail(409,'Business authority changed before action');
      for(const prior of c.receipts)if(snapshots[prior.intent.role].version!==prior.receipt.version || !matches(snapshots[prior.intent.role].data,prior.intent.to))fail(409,'Previously applied action changed externally');
      if(snapshots[step.role].version!==step.expectedVersion || !matches(snapshots[step.role].data,step.from))fail(409,'Target drift before action');
      const intent={id:`${c.id}-${index}`,kind:'apply',resource:c.resource,role:step.role,expectedVersion:step.expectedVersion,from:step.from,to:step.to,workflow:c.id};
      const receipt=await this.perform(c,intent);c.receipts.push({intent,receipt});delete c.intent;this.save(c,'workflow-action-applied');
    }
    c.state='VERIFYING';this.save(c,'workflow-verifying');await this.verify(c);
  }
  async verify(c) {
    const snapshots=await this.snapshots(c);c.verification={at:now(),snapshots,checks:Object.entries(this.expected(c)).map(([role,expected])=>({role,passed:matches(snapshots[role].data,expected)}))};
    for(const {intent,receipt} of c.receipts)if(snapshots[intent.role].version!==receipt.version)fail(409,'External revision drift during outcome verification; human reconciliation required');
    if(c.verification.checks.some(x=>!x.passed)){c.state='COMPENSATING';c.compensating=true;c.reason='Outcome verification failed; compensate owned writes';this.save(c,'workflow-verification-failed');return;}
    c.state='COMPLETED';c.reason='All authoritative system postconditions verified';this.save(c,'workflow-completed');
  }
  async compensate(c) {
    this.policy(c,{evidence:true});
    const reversed=[...c.receipts].reverse();
    for(let i=c.compensations.length;i<reversed.length;i++){
      const {intent:original,receipt}=reversed[i];
      const intent=c.intent??{id:original.id+'-undo',kind:'compensate',resource:c.resource,role:original.role,expectedVersion:receipt.version,from:original.to,to:original.from,workflow:c.id};
      const r=await this.perform(c,intent);c.compensations.push({intent,receipt:r});delete c.intent;this.save(c,'workflow-compensation-applied');
    }
    const snapshots=await this.snapshots(c);
    for(const {intent} of c.receipts)if(!matches(snapshots[intent.role].data,intent.from))fail(409,'Compensation postcondition not satisfied');
    c.state='COMPENSATED';c.reason='Owned writes compensated; original business failure still requires resolution';this.save(c,'workflow-compensated');
  }
  async run(c) {
    try {
      if(['QUEUED','INVESTIGATING'].includes(c.state))await this.investigate(c);
      if(c.state==='EXECUTING')await this.execute(c);
      if(c.state==='VERIFYING')await this.verify(c);
      if(c.state==='COMPENSATING')await this.compensate(c);
    }catch(e){
      if(e.status===502 && (c.retries??0)<3){c.retries=(c.retries??0)+1;c.retryAt=new Date(Date.now()+1000*2**c.retries).toISOString();c.reason='Transient adapter failure; durable receipt reconciliation will retry automatically';this.save(c,'workflow-retry-scheduled');}
      else if(e.actionRejected && c.receipts.length){c.state='COMPENSATING';c.compensating=true;c.reason='Action rejected without effect; compensate preceding owned writes';this.save(c,'workflow-recovery-queued');}
      else{c.state='HELD';c.reason=e.status?e.message:'Investigation or adapter failed; review evidence and reconcile before resuming';this.save(c,'workflow-held');}
    }
  }
  schedule(){
    if(Date.now()<this.nextSchedule)return;this.nextSchedule=Date.now()+1000;
    for(const b of this.config.workflowBindings??[]){
      if(!b.enabled || !b.reconcile)continue;
      const user=this.config.users.find(u=>u.tenant===b.tenant&&u.id===b.reconcile.identity&&u.roles.includes('collector'));if(!user)continue;
      const bucket=Math.floor(Date.now()/(b.reconcile.intervalSeconds*1000));
      for(const resource of b.reconcile.resources){
        if(this.store.workflowActive(b.tenant,b.id,resource))continue;
        const key='reconcile-'+digest([b.id,resource,bucket]);
        try{this.submit(user,{binding:b.id,resource,source:'schedule',externalId:key,summary:this.packs[b.pack].objective},key);}catch(e){if(![409,429].includes(e.status))throw e;}
      }
    }
  }
  tick() {
    if(this.stopped || this.config.workflowPaused)return;
    this.delivery.tick();this.schedule();
    for(const c of this.store.workflowPending()){
      if(this.jobs.size>=2)break;if(this.jobs.has(c.tenant))continue;
      const job=this.run(c).catch(()=>{}).finally(()=>this.jobs.delete(c.tenant));this.jobs.set(c.tenant,job);
    }
  }
  async stop(){this.stopped=true;await Promise.all(this.jobs.values());await this.delivery.stop();}
}
export { catalog };
