import { readFileSync } from 'node:fs';
try{
  const config=JSON.parse(readFileSync(process.env.CG_CONFIG??'data/config.json','utf8'));
  const user=config.users.find(u=>u.roles.includes('viewer')||u.roles.includes('operator')||u.roles.includes('admin'));
  const base=process.env.CG_URL??'http://127.0.0.1:4310';
  const apiUrl=new URL(base);
  if(apiUrl.username || apiUrl.password || !(apiUrl.protocol==='https:' || apiUrl.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(apiUrl.hostname)))throw new Error('Diagnostic API requires HTTPS outside loopback; URL credentials are forbidden');
  for(const path of ['/healthz','/readyz','/api/operations']){
    const response=await fetch(base+path,{headers:{authorization:'Bearer '+user.token},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error(path+' returned HTTP '+response.status);
    console.log(path+': '+JSON.stringify(await response.json()));
  }
  if(config.llm?.provider==='ollama'){
    const url=new URL(process.env.CG_MODEL_BASE??config.llm.url);
    url.pathname='/api/tags';url.search='';
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Model server is unavailable');
    const names=(await response.json()).models?.map(m=>m.name)??[];
    for(const model of [config.llm.model,config.llm.embeddingModel])if(!names.includes(model))throw new Error('Model not installed: '+model);
    console.log('Configured reasoning and embedding models are installed. Run an investigation to test inference.');
  }else console.log('Hosted model configuration detected; no billable inference was requested by this diagnostic.');
}catch(e){console.error('Diagnostic failed: '+e.message);process.exitCode=1;}
