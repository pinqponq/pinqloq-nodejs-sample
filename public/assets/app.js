const POLL_INTERVAL_MS = 700;
const DISCONNECTED_POLL_INTERVAL_MS = 5000;
const findElement = id => document.getElementById(id);
const states = { generating: 'ÜRETİLİYOR', draining: 'KUYRUK BOŞALIYOR', complete: 'API KABUL ETTİ', stopped: 'DURDURULDU', failed: 'KONTROL GEREKİYOR' };
let selectedId;
let runs = [];
let submitting = false;

async function requestApi(path, body) {
  const serializedBody = body ? JSON.stringify(body) : undefined;
  const options = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: serializedBody } : undefined;
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'İstek tamamlanamadı.');
  return result;
}

function setText(id, value) { findElement(id).textContent = value; }
function render() {
  const active = runs.find(run => !run.finishedAt);
  document.querySelectorAll('[data-status], [data-redaction], #manual, #load').forEach(button => { button.disabled = Boolean(active) || submitting; });
  const run = runs.find(item => item.id === selectedId) || active || runs[0];
  findElement('stop').disabled = !active || active.stopRequested || active.generationDone;
  findElement('copy').disabled = !run;
  if (run) {
    selectedId = run.id;
    setText('run-state', states[run.state]);
    setText('run-id', run.id);
    setText('generated', run.generated.toLocaleString('tr-TR'));
    setText('accepted', run.accepted.toLocaleString('tr-TR'));
    setText('requests', run.batches.length);
    setText('queued', run.queued - run.submitted);
    setText('planned', `/ ${run.planned.toLocaleString('tr-TR')} planlanan`);
    findElement('progress').style.width = `${Math.min(100, run.settled / Math.max(1, run.generated) * 100)}%`;
    setText('progress-caption', run.finishedAt ? `Tamamlandı · ${run.dropped} kuyruk reddi` : run.stopRequested ? 'Üretim duruyor; kuyruktaki loglar gönderilecek.' : run.generationDone ? 'Gönderim ve API yanıtları bekleniyor…' : 'Sentetik loglar üretiliyor…');
    const elapsed = (Date.parse(run.finishedAt || new Date().toISOString()) - Date.parse(run.startedAt)) / 1000;
    setText('elapsed', `${elapsed.toFixed(1)} sn`);
    const body = findElement('batches');
    body.replaceChildren();
    if (!run.batches.length) {
      const row = body.insertRow();
      const cell = row.insertCell(); cell.colSpan = 5; cell.className = 'empty'; cell.textContent = 'Kuyruk birikiyor. İlk batch bekleniyor…';
    }
    for (const batch of run.batches) {
      const row = body.insertRow();
      for (const value of [batch.collection, batch.count, batch.acceptedCount ?? '—', batch.status ?? '…', batch.durationMs === undefined ? '…' : `${batch.durationMs} ms`]) row.insertCell().textContent = String(value);
    }
    setText('errors', run.errors.join(' · ') || (run.state === 'failed' ? 'Bazı kayıtların kabulü doğrulanamadı. Batch sonuçlarını incele.' : ''));
  }
  const history = findElement('history');
  history.replaceChildren();
  if (!runs.length) history.textContent = 'Bu oturumda henüz test yok.';
  for (const item of runs.slice(0, 5)) {
    const button = document.createElement('button');
    button.textContent = `${item.scenario.kind} · ${item.generated} log — ${states[item.state]}`;
    button.onclick = () => { selectedId = item.id; render(); };
    history.append(button);
  }
}

async function start(scenario) {
  submitting = true; setText('notice', ''); render();
  try { const run = await requestApi('/api/runs', scenario); selectedId = run.id; await refresh(); }
  catch (error) { console.error('Sample action failed.', error); setText('notice', error.message); }
  finally { submitting = false; render(); }
}
async function refresh() {
  runs = await requestApi('/api/runs');
  setText('connection', '● Yerel sunucu bağlı');
  render();
}
document.querySelectorAll('[data-status]').forEach(button => button.onclick = () => start({ kind: 'http', status: Number(button.dataset.status) }));
document.querySelectorAll('[data-redaction]').forEach(button => button.onclick = () => start({ kind: 'redaction', mode: button.dataset.redaction }));
findElement('manual').onclick = () => start({ kind: 'manual', level: Number(findElement('level').value) });
findElement('load').onclick = () => start({ kind: 'load', total: Number(findElement('load-size').value) });
findElement('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(selectedId); setText('notice', 'Test kimliği kopyalandı.'); }
  catch (error) { console.warn('Could not copy the test identifier.', error); setText('notice', 'Kopyalanamadı; test kimliğini seçerek kopyalayabilirsin.'); }
};
findElement('stop').onclick = async () => {
  const active = runs.find(run => !run.finishedAt);
  if (!active) return;
  try { await requestApi(`/api/runs/${active.id}/stop`, {}); await refresh(); }
  catch (error) { console.error('Sample action failed.', error); setText('notice', error.message); }
};
try {
  const config = await requestApi('/api/config');
  setText('http-collection', config.httpCollection); setText('manual-collection', config.manualCollection);
  await refresh();
} catch (error) { console.error('Sample connection failed.', error); setText('connection', 'Bağlantı yok'); setText('notice', error.message); }
async function poll() {
  let nextPollInterval = POLL_INTERVAL_MS;
  try { await refresh(); } catch (error) {
    console.warn('Sample polling failed.', error);
    setText('connection', 'Sunucuya ulaşılamıyor');
    nextPollInterval = DISCONNECTED_POLL_INTERVAL_MS;
  }
  setTimeout(poll, nextPollInterval);
}
setTimeout(poll, POLL_INTERVAL_MS);
