// Explicit CI-only protocol fixture. Production never imports this module.
import { modelFixture } from '../test/model-fixture.mjs';
if (process.env.CI_MODEL_FIXTURE !== 'true') throw new Error('CI_MODEL_FIXTURE=true required');
const model=await modelFixture(null,{port:11434,host:'0.0.0.0'});
console.log('CI-only fake model listening; this is NOT model-quality validation.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await model.close();process.exit(0);});
