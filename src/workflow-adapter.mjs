import { trustedSource, ConnectorError } from './connectors.mjs';

export class AdapterError extends Error { constructor(message, status=502) { super(message); this.status=status; } }
export class WorkflowAdapter {
  constructor(config, tenant, binding) { this.config=config;this.tenant=tenant;this.binding=binding; }
  async request(path, method='GET', body) {
    const {url,trust}=trustedSource(this.config,this.tenant,this.binding.endpoint);
    url.pathname=url.pathname.replace(/\/$/,'')+path;
    const headers={accept:'application/json'};
    if (trust.secretEnv) {
      const value=process.env[trust.secretEnv];
      if (!value || /[\r\n]/.test(value)) throw new AdapterError('Adapter credential unavailable');
      headers.authorization=`Bearer ${value}`;
    }
    if(body)headers['content-type']='application/json';
    try {
      const response=await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
      if(response.status===404 && method==='GET' && path.startsWith('/v1/operations/')){await response.body?.cancel();return null;}
      if(!response.ok){await response.body?.cancel();throw new AdapterError(`Adapter returned HTTP ${response.status}`,response.status===409?409:502);}
      let size=0;const parts=[];
      for await (const part of response.body){size+=part.length;if(size>65536)throw new AdapterError('Adapter response exceeds 64 KB');parts.push(part);}
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    }catch(e){if(e instanceof AdapterError || e instanceof ConnectorError)throw e;throw new AdapterError('Adapter unavailable or returned invalid data; reconcile action receipt before retry');}
  }
  async read(resource) {
    const value=await this.request('/v1/resources/'+encodeURIComponent(resource));
    if(value?.id!==resource || !Number.isSafeInteger(value.version) || value.version<1 || !value.data || typeof value.data!=='object' || Array.isArray(value.data) || !Number.isFinite(Date.parse(value.observedAt)) || Math.abs(Date.now()-Date.parse(value.observedAt))>60000)throw new AdapterError('Invalid or stale adapter resource');
    return value;
  }
  receipt(id){return this.request('/v1/operations/'+encodeURIComponent(id));}
  apply(intent){return this.request('/v1/operations/'+encodeURIComponent(intent.id),'PUT',intent);}
}
