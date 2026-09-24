import { digest, now, uid } from './store.mjs';
import { fail } from './engine.mjs';
import { validateBundle } from './investigation.mjs';
import { ConnectorError, validateConnection, collectPrometheus, hasBreach, alertEvent } from './connectors.mjs';

export class Automation {
  constructor(store,engine,config,collector=collectPrometheus){
    this.store=store;this.engine=engine;this.config=config;this.collector=collector;this.jobs=new Map();this.stopped=false;
    for(const c of store.collectionPending())if(c.state==='COLLECTING'){c.state='QUEUED';store.saveCollection(c);}
  }
  connection(user,id){const c=this.store.connection(user.tenant,id);if(!c)fail(404,'Connection not found');return c;}
  configure(user,input){
    let c;try{c=validateConnection(input,this.config,user.tenant);}catch(e){fail(400,e.message);}
    const previous=this.store.connection(user.tenant,c.id);
    if(previous && input.revision!==previous.revision)fail(409,'Connection revision changed; reload before saving');
    if(!previous && this.store.connections(user.tenant).length>=20)fail(409,'Connection quota reached');
    c.revision=(previous?.revision??0)+1;c.updatedAt=now();c.updatedBy=user.id;c.nextRunAt=new Date(Date.now()+c.intervalSeconds*1000).toISOString();
    this.store.transaction(()=>{this.store.putConnection(user.tenant,c);this.store.audit(user.tenant,user.id,'connection-configured',{id:c.id,revision:c.revision,enabled:c.enabled,intervalSeconds:c.intervalSeconds});});return c;
  }
  enqueue(user,connectionId,key,trigger='manual'){
    if(this.config.automationPaused)fail(409,'Collection is paused by the host operator');
    if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(key))fail(400,'Idempotency-Key must be 8-100 safe characters');
    const existing=this.store.collectionByKey(user.tenant,key);
    if(existing){if(existing.connectionId!==connectionId)fail(409,'Collection key reused for another connection');return existing;}
    const c=this.connection(user,connectionId);if(!c.enabled)fail(409,'Connection is disabled');
    if(this.store.collectionCount(user.tenant)>=20)fail(429,'Collection queue limit reached');
    const job={id:uid(),tenant:user.tenant,requester:user.id,connectionId,connectionRevision:c.revision,trigger,state:'QUEUED',attempts:0,createdAt:now(),updatedAt:now(),nextAttemptAt:now()};
    this.store.transaction(()=>{this.store.insertCollection(job,key);this.store.audit(user.tenant,user.id,'collection-queued',{id:job.id,connectionId,trigger});});return job;
  }
  webhook(user,id,payload){
    let event;try{event=alertEvent(payload);}catch(e){fail(400,e.message);}
    this.connection(user,id);
    if(event.status==='resolved' || !event.events.some(e=>e.status==='firing'))return {status:'ignored',reason:'No firing alerts'};
    return this.enqueue(user,id,'alert-'+digest({id,events:event.events.filter(e=>e.status==='firing')}),'alertmanager');
  }
  deployment(user,environment,input){
    if(typeof environment!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(environment))fail(400,'Invalid environment');
    const services=this.store.connections(user.tenant).filter(c=>c.environment===environment).flatMap(c=>c.services);
    const unique=[...new Map(services.map(s=>[s.id,s])).values()];
    if(!unique.some(s=>s.id===input?.service))fail(400,'Deployment must reference a registered environment service');
    let value;try{const at=now();value=validateBundle({capturedAt:at,source:'deployment event',services:unique,signals:[{id:'validation',service:input.service,metric:'queue_depth',before:0,after:0,limit:0,observedAt:at}],deployments:[input]}).deployments[0];}catch(e){fail(400,e.message);}
    value.at=new Date(value.at).toISOString();if(value.rollbackTestedAt)value.rollbackTestedAt=new Date(value.rollbackTestedAt).toISOString();
    const existing=this.store.deployment(user.tenant,environment,value.id);
    if(existing){if(digest(existing)!==digest(value))fail(409,'Deployment ID already has different evidence');return existing;}
    if(this.store.deployments(user.tenant,environment).length>=80)fail(429,'Environment deployment quota reached for the current window');
    this.store.transaction(()=>{this.store.putDeployment(user.tenant,environment,value);this.store.audit(user.tenant,user.id,'deployment-recorded',{id:value.id,environment,service:value.service});});return value;
  }
  schedule(){
    if(this.config.automationPaused)return;
    for(const tenant of new Set(this.config.users.map(u=>u.tenant))){
      for(const c of this.store.connections(tenant)){
        if(!c.enabled || !c.intervalSeconds || Date.parse(c.nextRunAt)>Date.now())continue;
        if(this.store.collectionPending().some(j=>j.tenant===tenant && j.connectionId===c.id))continue;
        // Service principal is attributed separately; its authority is limited to assessment collection.
        try{this.enqueue({id:'scheduler',tenant},c.id,'schedule-'+digest({tenant,id:c.id,at:c.nextRunAt}),'schedule');c.nextRunAt=new Date(Date.now()+c.intervalSeconds*1000).toISOString();this.store.putConnection(tenant,c);}
        catch(e){if(e.status!==429)throw e;}
      }
    }
  }
  async run(job){
    job.state='COLLECTING';job.attempts++;this.store.saveCollection(job);
    try{
      const committed=this.store.byKey(job.tenant,'collection-'+job.id);
      if(committed){job.assessmentId=committed.id;job.state='SUBMITTED';job.reason='Recovered previously committed investigation';this.store.saveCollection(job);return;}
      const connection=this.store.connection(job.tenant,job.connectionId);
      if(!connection?.enabled || connection.revision!==job.connectionRevision)throw new ConnectorError('Connection disabled or changed; collect again after review');
      if(job.trigger!=='schedule' && !this.config.users.some(u=>u.id===job.requester && u.tenant===job.tenant && (u.roles.includes('operator') || u.roles.includes('collector'))))throw new ConnectorError('Collection requester is no longer authorized');
      const bundle=await this.collector(connection,this.config,job.tenant,this.store.deployments(job.tenant,connection.environment));
      const current=this.store.connection(job.tenant,job.connectionId);
      if(this.config.automationPaused || !current?.enabled || current.revision!==job.connectionRevision)throw new ConnectorError('Collection policy changed while collecting; no investigation submitted');
      if(job.trigger!=='schedule' && !this.config.users.some(u=>u.id===job.requester && u.tenant===job.tenant && (u.roles.includes('operator') || u.roles.includes('collector'))))throw new ConnectorError('Collection requester authority changed while collecting');
      job.bundleDigest=digest(bundle);job.observedAt=bundle.capturedAt;
      if(connection.mode==='on-breach' && !hasBreach(bundle)){job.state='HEALTHY';job.reason='No supplied threshold breached; model investigation not requested';}
      else{
        const assessment=this.engine.submit({id:job.requester,tenant:job.tenant},{kind:'assessment',title:connection.question,environment:connection.environment,bundle},'collection-'+job.id);
        job.assessmentId=assessment.id;job.state='SUBMITTED';job.reason='Evidence collected; agentic investigation queued';
      }
      this.store.transaction(()=>{this.store.saveCollection(job);this.store.audit(job.tenant,'collector','collection-completed',{id:job.id,state:job.state,assessmentId:job.assessmentId,bundleDigest:job.bundleDigest});});
    }catch(e){
      const retry=(e instanceof ConnectorError && e.retryable || e.status===429) && job.attempts<3;
      job.state=retry?'QUEUED':'FAILED';job.nextAttemptAt=new Date(Date.now()+Math.min(60000,5000*2**job.attempts)).toISOString();
      job.reason=e instanceof ConnectorError || e.status?e.message:'Collection failed safely';
      this.store.transaction(()=>{this.store.saveCollection(job);this.store.audit(job.tenant,'collector',retry?'collection-retry':'collection-failed',{id:job.id,attempt:job.attempts,reason:job.reason});});
    }
  }
  tick(){
    if(this.stopped || this.config.automationPaused)return;
    this.schedule();
    for(const job of this.store.collectionPending()){
      if(this.jobs.size>=2)break;
      if(this.jobs.has(job.tenant)||Date.parse(job.nextAttemptAt)>Date.now())continue;
      const running=this.run(job).catch(()=>{}).finally(()=>this.jobs.delete(job.tenant));this.jobs.set(job.tenant,running);
    }
  }
  async stop(){this.stopped=true;await Promise.all([...this.jobs.values()]);}
}
