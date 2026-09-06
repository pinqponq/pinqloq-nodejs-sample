import { setTimeout as delay } from 'node:timers/promises';

const POLL_INTERVAL_MS = 700;
const TEST_TIMEOUT_MS = 120000;

const baseUrl = process.env.SAMPLE_URL || 'http://127.0.0.1:3100';
const total = Number(process.argv[2] || 100);
if (![100, 1000].includes(total)) throw new Error('Choose 100 or 1000 logs: npm run load -- 1000');
const response = await fetch(`${baseUrl}/api/runs`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'load', total })
});
if (!response.ok) throw new Error(`Could not start test: HTTP ${response.status}`);
let run = await response.json();
console.log(`Started ${run.id}`);
const deadline = Date.now() + TEST_TIMEOUT_MS;
while (!run.finishedAt && Date.now() < deadline) {
  await delay(POLL_INTERVAL_MS);
  run = await (await fetch(`${baseUrl}/api/runs/${run.id}`)).json();
}
console.log(JSON.stringify(run, null, 2));
if (run.state !== 'complete') process.exitCode = 1;
