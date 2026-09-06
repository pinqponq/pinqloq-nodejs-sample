import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const POLL_INTERVAL_MS = 700;
const TEST_TIMEOUT_MS = 120000;

const baseUrl = process.env.SAMPLE_URL || 'http://127.0.0.1:3100';
const runIds = [];
for (const scenario of [{ kind: 'http', status: 500 }, { kind: 'manual', level: 4 }, { kind: 'load', total: 1000 }]) {
  const response = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scenario)
  });
  assert.equal(response.status, 202);
  let run = await response.json();
  runIds.push(run.id);
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (!run.finishedAt && Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    run = await (await fetch(`${baseUrl}/api/runs/${run.id}`)).json();
  }
  console.log(JSON.stringify(run, null, 2));
  assert.equal(run.state, 'complete');
  assert.equal(run.accepted, run.planned);
}
console.log('API acceptance verified. Check these testRun/deviceIdentifier values in the panel:', runIds.join(', '));
