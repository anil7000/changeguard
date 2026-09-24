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
  panel.append(el('p', c.reason ?? 'Investigation queued. Gathering evidence and preparing a bounded rehearsal.'));
  const actions = el('div', undefined, 'actions');
  for (const [action, label, visible] of [
    ['approve', 'Approve exact action', c.state === 'REVIEW' && me.roles.includes('approver')],
    ['execute', 'Execute in synthetic target', c.state === 'APPROVED' && me.roles.includes('operator')],
    ['cancel', 'Cancel change', ['QUEUED', 'REVIEW', 'APPROVED', 'EXECUTE_QUEUED', 'HELD', 'BLOCKED'].includes(c.state) && me.roles.includes('operator')]
  ]) if (visible) { const button = el('button', label); button.addEventListener('click', async () => { button.disabled = true; try { await api(`/api/changes/${c.id}/${action}`, { method: 'POST' }); message(`${label}: accepted`); await refresh(); } catch (e) { message(e.message); button.disabled = false; } }); actions.append(button); }
  panel.append(actions);
  section(panel, 'Change specification', { id: c.id, requester: c.requester, industry: c.sector, replicas: c.replicas, poolPerReplica: c.poolPerReplica, capacityBudget: c.capacityBudget, policy: c.policyVersion });
  if (c.analysis) section(panel, 'Investigation · hypotheses, not confirmed RCA', c.analysis);
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
    for (const c of changes) { const row = el('tr'); const cell = el('td'); const button = el('button', c.title, 'link-button'); button.addEventListener('click', () => { selected = c.id; drawDetail(c); }); cell.append(button); const state = el('td'); state.append(badge(c.state)); row.append(cell, el('td', c.sector), state, el('td', `${c.replicas * c.poolPerReplica} / ${c.capacityBudget ?? '?'}`)); $('changes').append(row); }
    if (selected) { const c = changes.find(c => c.id === selected); if (c) drawDetail(c); }
    $('audit').replaceChildren(); for (const event of events.slice(-12).reverse()) { const row = el('div', undefined, 'audit-row'); row.append(el('time', new Date(event.at).toLocaleTimeString()), el('strong', event.event), el('span', event.actor)); $('audit').append(row); }
    $('documents').replaceChildren(); for (const doc of documents) { const row = el('p', `${doc.title} · ${doc.id}`, 'muted'); $('documents').append(row); }
    $('queue-status').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) { message(e.message); } finally { refreshing = false; }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); session++; lastView = ''; token = $('token').value.trim();
  try { me = await api('/api/me'); $('token').value = ''; $('login').hidden = true; $('workspace').hidden = false; $('logout').hidden = false; $('identity').textContent = `${me.id} · ${me.tenant} · ${me.llmConfigured ? 'model configured' : 'local analysis'}`; $('submit-panel').hidden = !me.roles.includes('operator'); $('ingest-panel').hidden = !me.roles.includes('admin'); message('Connected. Select a change or submit an investigation.'); await refresh(); }
  catch (e) { token = ''; message(e.message); }
});
$('logout').addEventListener('click', () => { session++; token = ''; me = null; selected = null; records = []; auditRecords = []; $('login').hidden = false; $('workspace').hidden = true; $('logout').hidden = true; $('identity').textContent = 'Not connected'; $('changes').replaceChildren(); $('audit').replaceChildren(); $('documents').replaceChildren(); $('detail').replaceChildren(el('h2', 'Select a change')); message('Disconnected. Use the other identity for independent review.'); });
$('refresh').addEventListener('click', refresh);
$('change-form').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.target); const payload = { title: form.get('title'), sector: form.get('sector'), replicas: Number(form.get('replicas')), poolPerReplica: Number(form.get('poolPerReplica')), capacityBudget: form.get('capacityBudget') === '' ? null : Number(form.get('capacityBudget')), evidenceFresh: form.has('evidenceFresh'), rollbackTested: form.has('rollbackTested') }; try { const c = await api('/api/changes', { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(payload) }); selected = c.id; message('Investigation queued. The background worker will collect evidence and run a rehearsal.'); await refresh(); } catch (e) { message(e.message); } });
$('document-form').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.target); try { await api('/api/documents', { method: 'POST', body: JSON.stringify({ title: form.get('title'), source: form.get('source'), text: form.get('text'), ttlHours: 168 }) }); event.target.reset(); message('Runbook ingested with a seven-day expiry.'); await refresh(); } catch (e) { message(e.message); } });
$('export').addEventListener('click', () => { const blob = new Blob([JSON.stringify(auditRecords, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = el('a'); a.href = url; a.download = 'changeguard-audit.json'; a.click(); URL.revokeObjectURL(url); });
setInterval(refresh, 3000);
