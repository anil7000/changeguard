import { trustedSource } from './connectors.mjs';
import { now } from './store.mjs';

export class WorkflowDelivery {
  constructor(store,config){this.store=store;this.config=config;this.running=null;this.stopped=false;}
  async send(d){
    try{
      const b=(this.config.workflowBindings??[]).find(b=>b.tenant===d.tenant && b.id===d.binding);
      if(!b?.enabled || b.notificationEndpoint!==d.endpoint)throw new Error('Notification binding disabled or changed');
      const {url,trust}=trustedSource(this.config,d.tenant,d.endpoint);url.pathname=url.pathname.replace(/\/$/,'')+'/v1/events';
      const headers={'content-type':'application/json','idempotency-key':d.id};
      if(trust.secretEnv){const value=process.env[trust.secretEnv];if(!value || /[\r\n]/.test(value))throw new Error('Notification credential unavailable');headers.authorization='Bearer '+value;}
      const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(d.payload),redirect:'error',signal:AbortSignal.timeout(10000)});
      await response.body?.cancel();if(!response.ok)throw new Error(`Notification HTTP ${response.status}`);
      d.state='DELIVERED';d.deliveredAt=now();d.reason='Receiver accepted notification';
    }catch(e){d.attempts++;d.state=d.attempts>=5?'FAILED':'PENDING';d.nextAt=new Date(Date.now()+Math.min(300000,1000*2**d.attempts)).toISOString();d.reason='Notification delivery failed; destination, credentials or receiver requires attention';}
    this.store.transaction(()=>{this.store.putDelivery(d);this.store.audit(d.tenant,'notification-worker','workflow-notification-'+d.state.toLowerCase(),{deliveryId:d.id,workflowId:d.payload.workflowId,attempts:d.attempts});});
  }
  tick(){if(this.stopped || this.running)return;const d=this.store.deliveryPending()[0];if(d)this.running=this.send(d).catch(()=>{}).finally(()=>{this.running=null;});}
  async stop(){this.stopped=true;await this.running;}
}
