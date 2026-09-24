import { digest } from './store.mjs';
import { chat, embed, ModelError } from './model.mjs';
const tokenize = text => text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
export function chunks(documents, clock = Date.now()) {
  return documents.filter(d => Date.parse(d.expiresAt) > clock).flatMap(d => (d.text.match(/[\s\S]{1,900}/g) ?? []).map((text,index) => ({ documentId: d.id, title: d.title, source: d.source, digest: d.digest, expiresAt: d.expiresAt, chunk: index, text })));
}
function lexical(corpus, query) {
  const terms = [...new Set(tokenize(query))]; const frequency = new Map();
  const words = corpus.map(c => new Set(tokenize(c.title + ' ' + c.text)));
  for (const set of words) for (const word of set) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  return corpus.map((c,i) => ({ ...c, score: terms.reduce((sum,t) => sum + (words[i].has(t) ? Math.log(1 + corpus.length / (1 + frequency.get(t))) : 0), 0) }));
}
export function retrieve(documents, query, clock = Date.now()) { return lexical(chunks(documents,clock), query).filter(c => c.score > 0).sort((a,b) => b.score-a.score).slice(0,5); }
const cosine = (a,b) => a.reduce((s,n,i) => s+n*b[i],0) / (Math.hypot(...a)*Math.hypot(...b));
export async function hybridRetrieve(store, tenant, query, config, { documentIds } = {}) {
  const corpus = chunks(store.docs(tenant).filter(d=>!documentIds || documentIds.includes(d.id)));
  if (!corpus.length) throw new ModelError('No fresh evidence available for required RAG');
  if (corpus.length > 512) throw new ModelError('RAG corpus exceeds 512 chunks; split the evidence scope');
  const model = digest({ url: config.llm?.embeddingUrl, model: config.llm?.embeddingModel });
  const keyed = corpus.map(c => ({ c, key: digest([c.documentId,c.digest,c.chunk]) }));
  const vectors = keyed.map(x => store.embedding(tenant,model,x.key));
  const missing = keyed.map((x,i) => vectors[i] ? -1 : i).filter(i => i >= 0);
  for (let offset = 0; offset < missing.length; offset += 16) {
    const indexes = missing.slice(offset,offset+16);
    const batch = await embed(config,indexes.map(i => corpus[i].title + '\n' + corpus[i].text));
    indexes.forEach((i,j) => { vectors[i] = batch[j]; });
  }
  const [q] = await embed(config, [query]);
  if (vectors.some(v => v.length !== q.length)) throw new ModelError('Embedding dimension changed; re-ingest evidence');
  if (keyed.some(({c}) => store.doc(tenant,c.documentId)?.digest !== c.digest)) throw new ModelError('Evidence changed during retrieval; resubmit');
  store.transaction(() => missing.forEach(i => store.putEmbedding(tenant,model,keyed[i].key,vectors[i])));
  const lexicalRank = lexical(corpus,query).map((c,i) => ({ ...c,i })).sort((a,b) => b.score-a.score);
  const semanticRank = corpus.map((c,i) => ({ i, similarity: cosine(vectors[i],q) })).sort((a,b) => b.similarity-a.similarity);
  const scores = new Map();
  lexicalRank.filter(c => c.score > 0).forEach((c,r) => scores.set(c.i,1/(60+r+1)));
  semanticRank.forEach((c,r) => scores.set(c.i,(scores.get(c.i) ?? 0)+1/(60+r+1)));
  return [...scores].sort((a,b) => b[1]-a[1]).slice(0,5).map(([i,score]) => ({ ...corpus[i], score, retrieval: 'hybrid-rrf', similarity: semanticRank.find(c => c.i === i).similarity }));
}
export const analysisSchema = { type: 'object', required: ['summary','hypotheses'], properties: { summary: { type: 'string' }, hypotheses: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', required: ['claim','citations'], properties: { claim: { type: 'string' }, citations: { type: 'array', minItems: 1, items: { type: 'string' } } } } } } };
export function validateAnalysis(parsed, evidence) {
  const allowed = new Set(evidence.map(e => e.documentId));
  if (!parsed || typeof parsed.summary !== 'string' || !parsed.summary.trim() || parsed.summary.length > 3000 || !Array.isArray(parsed.hypotheses) || parsed.hypotheses.length < 1 || parsed.hypotheses.length > 5) throw new ModelError('Invalid analysis: require 1-5 evidence-backed hypotheses');
  for (const h of parsed.hypotheses) if (!h || typeof h.claim !== 'string' || !h.claim.trim() || h.claim.length > 1500 || !Array.isArray(h.citations) || !h.citations.length || h.citations.length > 10 || !h.citations.every(id => allowed.has(id))) throw new ModelError('Invalid evidence citation in analysis');
  return { summary: parsed.summary, hypotheses: parsed.hypotheses.map(h => ({ claim: h.claim, citations: [...new Set(h.citations)] })) };
}
export async function propose(change, evidence, config) {
  const parsed = await chat(config, 'Analyze the proposed synthetic connection-pool change against the evidence. JSON: {summary:string,hypotheses:[{claim:string,citations:[documentId]}]}. Require at least one cited hypothesis; distinguish observations from assumptions.', { change, evidence }, analysisSchema);
  return { provider: 'configured-model', ...validateAnalysis(parsed,evidence), limitation: 'Model hypotheses are unverified. Only deterministic policy can allow bounded synthetic execution.' };
}
