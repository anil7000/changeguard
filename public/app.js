let token = ''; let me; let selected; let records = []; let auditRecords = []; let refreshing = false; let session = 0; let lastView = ''; let messageTimer;
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function message(text) { clearTimeout(messageTimer); $('message').textContent = text; messageTimer = setTimeout(() => { $('message').textContent = ''; }, 8000); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${token}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `Request failed: ${response.status}`); return data;
}
function badge(state) { return el('span', state.replaceAll('_', ' '), `badge ${state}`); }
function section(parent, title, value) { parent.append(el('h3', title), el('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2))); }
function drawDetail(c) {
  const panel = $('detail'); panel.replaceChildren(el('p', 'INVESTIGATION WORKSPACE', 'eyebrow'), el('h2', c.title), badge(c.state));
  panel.append(el('p', c.reason ?? (c.kind === 'assessment' ? 'Investigation queued. Planning read-only evidence checks.' : 'Investigation queued. Gathering evidence and preparing a bounded rehearsal.')));
  if (c.analysis) {
    panel.append(el('h3','Assessment · hypotheses, not confirmed RCA'),el('p',c.analysis.summary));
    for (const h of c.analysis.hypotheses) { const finding=el('div',undefined,'evidence'); finding.append(el('p',h.claim),el('small',`Evidence: ${h.citations.join(' · ')}`)); panel.append(finding); }
    panel.append(el('p',c.analysis.limitation,'muted'));
  }
  const actions = el('div', undefined, 'actions');
  for (const [action, label, visible] of [
    ['approve', 'Approve exact action', c.state === 'REVIEW' && me.roles.includes('approver')],
    ['execute', 'Execute in synthetic target', c.state === 'APPROVED' && me.roles.includes('operator')],
    ['cancel', 'Cancel change', ['QUEUED', 'REVIEW', 'APPROVED', 'EXECUTE_QUEUED', 'HELD', 'BLOCKED'].includes(c.state) && me.roles.includes('operator')]
  ]) if (visible) { const button = el('button', label); button.addEventListener('click', async () => { button.disabled = true; try { await api(`/api/changes/${c.id}/${action}`, { method: 'POST' }); message(`${label}: accepted`); await refresh(); } catch (e) { message(e.message); button.disabled = false; } }); actions.append(button); }
  panel.append(actions);
  if (c.kind === 'assessment') {
    panel.append(el('p', `Risk routing: ${c.risk ?? 'pending'} · Stage: ${c.progress ?? 'queued'}`, 'notice'));
    if (c.impact) { panel.append(el('h3','Potential blast radius')); const table = el('table'); const header=el('tr'); for(const name of ['Service','Owner','Tier','Evidence status'])header.append(el('th',name));table.append(header); for (const s of c.impact.affected) { const row = el('tr'); row.append(el('td',s.service),el('td',s.owner),el('td',s.tier),el('td',s.reason)); table.append(row); } const wrapper=el('div',undefined,'table-wrap');wrapper.append(table);panel.append(wrapper); }
    if (c.plan) { panel.append(el('h3','Agent plan · unverified rationale, not a finding'),el('p',c.plan.reason)); }
    if (c.trace) for (const trace of c.trace) { const details = el('details'); details.append(el('summary',trace.tool)); section(details,'Tool receipt',trace); panel.append(details); }
    if (c.review) { panel.append(el('h3','Skeptical evidence review · same model, not independent assurance'));for(const check of c.review.checks)panel.append(el('p',`Hypothesis ${check.index+1} · ${check.supported?'supported as a hypothesis':'unsupported'}: ${check.reason}`)); }
    if (c.nextSteps) { panel.append(el('h3','Operator next steps'));const steps=el('ol');for(const step of c.nextSteps)steps.append(el('li',step));panel.append(steps); }
    if (c.timings) section(panel,'Measured investigation timing',c.timings);
    const exportButton = el('button','Export investigation JSON'); exportButton.addEventListener('click',() => download(c,`changeguard-${c.id}.json`)); panel.append(exportButton);
  }
  section(panel, 'Change specification', { id: c.id, requester: c.requester, industry: c.sector, replicas: c.replicas, poolPerReplica: c.poolPerReplica, capacityBudget: c.capacityBudget, policy: c.policyVersion });
  if (c.evidence) { panel.append(el('h3', 'Retrieved evidence')); for (const e of c.evidence) { const card = el('div', undefined, 'evidence'); card.append(el('strong', `${e.title} · ${e.documentId}`), el('p', e.text), el('small', `Source: ${e.source} · expires ${e.expiresAt}`)); panel.append(card); } }
  if (c.rehearsal) section(panel, 'Measured rehearsal result', c.rehearsal);
  if (c.action) section(panel, 'Exact bounded action', c.action);
  if (c.approval) section(panel, 'Independent approval', c.approval);
  if (c.receipt) section(panel, 'Execution receipt', c.receipt);
  if (c.verification) section(panel, 'Post-execution verification', c.verification);
}
async function refresh() {
  if (!token || refreshing) return; refreshing = true; const currentSession = session;
  try {
    const [changes, target, events, documents] = await Promise.all(['/api/changes', '/api/target', '/api/audit', '/api/documents'].map(path => api(path)));
    if (currentSession !== session || !token) return;
    const view = JSON.stringify([changes, target, events, documents]);
    if (view === lastView) return;
    lastView = view;
    records = changes; auditRecords = events;
    $('count-all').textContent = changes.length; $('count-review').textContent = changes.filter(c => c.state === 'REVIEW').length; $('count-complete').textContent = changes.filter(c => c.state === 'COMPLETED').length; $('revision').textContent = target.revision;
    $('empty').hidden = changes.length > 0; $('changes').replaceChildren();
    for (const c of changes) { const row = el('tr'); const cell = el('td'); const button = el('button', c.title, 'link-button'); button.addEventListener('click', () => { selected = c.id; loadDetail(c.id); }); cell.append(button); const state = el('td'); state.append(badge(c.state)); row.append(cell, el('td', c.sector), state, el('td', c.kind === 'assessment' ? (c.risk ?? 'read-only') : `${c.replicas * c.poolPerReplica} / ${c.capacityBudget ?? '?'}`)); $('changes').append(row); }
    if (selected) await loadDetail(selected);
    $('audit').replaceChildren(); for (const event of events.slice(-12).reverse()) { const row = el('div', undefined, 'audit-row'); row.append(el('time', new Date(event.at).toLocaleTimeString()), el('strong', event.event), el('span', event.actor)); $('audit').append(row); }
    $('documents').replaceChildren(); for (const doc of documents) { const row = el('p', `${doc.title} · ${doc.id}`, 'muted'); $('documents').append(row); }
    $('queue-status').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) { message(e.message); } finally { refreshing = false; }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); session++; lastView = ''; token = $('token').value.trim();
  try { me = await api('/api/me'); $('token').value = ''; $('login').hidden = true; $('workspace').hidden = false; $('logout').hidden = false; $('identity').textContent = `${me.id} · ${me.tenant} · ${me.llmConfigured ? 'model configured' : 'AI unavailable — work will be held'}`; $('assessment-panel').hidden = !me.roles.includes('operator'); $('submit-panel').hidden = !me.roles.includes('operator'); $('ingest-panel').hidden = !me.roles.includes('admin'); message('Connected. Select a change or submit an investigation.'); await refresh(); }
  catch (e) { token = ''; message(e.message); }
});
$('logout').addEventListener('click', () => { session++; token = ''; me = null; selected = null; records = []; auditRecords = []; $('login').hidden = false; $('workspace').hidden = true; $('logout').hidden = true; $('identity').textContent = 'Not connected'; $('changes').replaceChildren(); $('audit').replaceChildren(); $('documents').replaceChildren(); $('detail').replaceChildren(el('h2', 'Select a change')); message('Disconnected. Use the other identity for independent review.'); });
$('refresh').addEventListener('click', refresh);
$('change-form').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.target); const payload = { title: form.get('title'), sector: form.get('sector'), replicas: Number(form.get('replicas')), poolPerReplica: Number(form.get('poolPerReplica')), capacityBudget: form.get('capacityBudget') === '' ? null : Number(form.get('capacityBudget')), evidenceFresh: form.has('evidenceFresh'), rollbackTested: form.has('rollbackTested') }; try { const c = await api('/api/changes', { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(payload) }); selected = c.id; message('Investigation queued. The background worker will collect evidence and run a rehearsal.'); await refresh(); } catch (e) { message(e.message); } });
$('document-form').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.target); try { await api('/api/documents', { method: 'POST', body: JSON.stringify({ title: form.get('title'), source: form.get('source'), text: form.get('text'), ttlHours: 168 }) }); event.target.reset(); message('Runbook ingested with a seven-day expiry.'); await refresh(); } catch (e) { message(e.message); } });
$('export').addEventListener('click', () => download(auditRecords,'changeguard-audit.json'));
setInterval(refresh, 3000);
function download(value,name) { const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})); const a = el('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000); message('JSON export requested. Check your browser downloads.'); }
async function loadDetail(id) { const currentSession=session; try { const c=await api(`/api/changes/${id}`); if(currentSession===session && selected===id && token)drawDetail(c); } catch(e) { if(currentSession===session)message(e.message); } }
$('example').addEventListener('click',async () => { try { $('bundle').value=JSON.stringify(await api('/api/example-bundle'),null,2); } catch(e) { message(e.message); } });
$('bundle-file').addEventListener('change',async event => { const file=event.target.files[0]; if (!file) return; if (file.size > 80000) return message('Bundle exceeds 80 KB'); $('bundle').value=await file.text(); });
$('assessment-form').addEventListener('submit',async event => { event.preventDefault(); const form=new FormData(event.target); try { const c=await api('/api/changes',{method:'POST',headers:{'idempotency-key':crypto.randomUUID()},body:JSON.stringify({kind:'assessment',title:form.get('title'),sector:form.get('sector'),bundle:JSON.parse($('bundle').value)})}); selected=c.id; message('Agentic investigation queued. Local inference can take several minutes.'); await refresh(); } catch(e) { message(e.message); } });
