// Isolated reference system implementing the adapter contract. No production vendor API is mocked implicitly.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { timingSafeEqual, createHash } from 'node:crypto';
import { digest } from '../src/store.mjs';
import { matches } from '../src/workflow-packs.mjs';

export async function referenceService({path=':memory:',token,role,transitions=[],initial,port=0,fault}={}) {
  if(!token || token.length<32)throw new Error('Reference service requires a strong credential');
  const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,body TEXT NOT NULL);');
  const read=id=>{const r=db.prepare('SELECT body FROM resources WHERE id=?').get(id);return r?JSON.parse(r.body):null;};
  const seed=(id,data)=>db.prepare('INSERT OR IGNORE INTO resources VALUES(?,?)').run(id,JSON.stringify({id,version:1,data}));
  for(const [id,data] of Object.entries(initial??{}))seed(id,data);
  const server=createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    try{
      const actual=createHash('sha256').update(req.headers.authorization??'').digest();const expected=createHash('sha256').update('Bearer '+token).digest();
      if(!timingSafeEqual(actual,expected))return reply(401,{error:'Unauthorized'});
      const resource=/^\/v1\/resources\/([a-zA-Z0-9_-]+)$/.exec(req.url);
      const operation=/^\/v1\/operations\/([a-zA-Z0-9_-]+)$/.exec(req.url);
      if(resource && req.method==='GET'){const value=read(resource[1]);return reply(value?200:404,value?{...value,observedAt:new Date().toISOString()}:{error:'Not found'});}
      if(operation && req.method==='GET'){const r=db.prepare('SELECT body FROM operations WHERE id=?').get(operation[1]);return reply(r?200:404,r?JSON.parse(r.body):{error:'Not found'});}
      if(operation && req.method==='PUT'){
        let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>10000)return reply(413,{error:'Too large'});parts.push(part);}
        const intent=JSON.parse(Buffer.concat(parts));
        if(intent.id!==operation[1] || intent.role!==role || !['apply','compensate'].includes(intent.kind) || typeof intent.resource!=='string' || !intent.from || !intent.to || Object.keys(intent.to).length!==1 || typeof intent.to.status!=='string')return reply(400,{error:'Invalid intent'});
        if(!transitions.some(s=>digest(intent.from)===digest(intent.kind==='apply'?s.from:s.to)&&digest(intent.to)===digest(intent.kind==='apply'?s.to:s.from)))return reply(403,{error:'Transition outside adapter authority'});
        const existing=db.prepare('SELECT body FROM operations WHERE id=?').get(intent.id);
        if(existing){const receipt=JSON.parse(existing.body);return reply(receipt.requestDigest===digest(intent)?200:409,receipt);}
        const rejection=fault?.beforeApply?.(intent);if(rejection)return reply(typeof rejection==='number'?rejection:503,{error:'Injected pre-commit failure'});
        const value=read(intent.resource);
        if(!value || value.version!==intent.expectedVersion || !matches(value.data,intent.from))return reply(409,{error:'Revision or precondition conflict'});
        const data={...value.data,...intent.to};const receipt={id:intent.id,resource:intent.resource,requestDigest:digest(intent),status:'applied',version:value.version+1,data};
        db.exec('BEGIN IMMEDIATE');
        try{db.prepare('UPDATE resources SET body=? WHERE id=?').run(JSON.stringify({id:value.id,version:receipt.version,data}),value.id);db.prepare('INSERT INTO operations VALUES(?,?)').run(intent.id,JSON.stringify(receipt));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        fault?.afterApply?.(intent,read,db);
        if(fault?.dropResponse?.(intent)){req.socket.destroy();return;}
        return reply(200,receipt);
      }
      reply(404,{error:'Not found'});
    }catch{if(!res.headersSent)reply(400,{error:'Invalid request'});}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,db,read,seed,async close(){await new Promise(r=>server.close(r));db.close();}};
}
