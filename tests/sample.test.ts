import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startSample } from '../src/app.js';
import { readConfig } from '../src/config.js';
import type { TestRun } from '../src/runs.js';

interface WireLog {
  logLevel: number;
  deviceIdentifier: string;
  correlationId: string;
  metadata: Record<string, string>;
  detail: Record<string, string>;
}
interface WireBatch { collectionName: string; logs: WireLog[] }
const config = { secretKey: 'test-only-not-a-real-secret', httpCollection: 'sample_http', manualCollection: 'sample_manual', port: 0 };
const networkFetch = globalThis.fetch;
const MASK = '*****REDACTED*****';

async function fixture(reply?: (batch: WireBatch) => Promise<Response>) {
  const batches: WireBatch[] = [];
  const transport: typeof fetch = async (input, options) => {
    const target = new URL(String(input));
    if (target.hostname === '127.0.0.1') return networkFetch(input, options);
    assert.equal(target.hostname, 'pinqloq-external-api.pinqponq.io');
    const batch = JSON.parse(String(options?.body)) as WireBatch;
    batches.push(batch);
    if (reply) return reply(batch);
    return Response.json({ accepted: true, acceptedCount: batch.logs.length });
  };
  const sample = await startSample(config, transport);
  return { ...sample, batches };
}

async function post(baseUrl: string, path: string, body: object) {
  return networkFetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function waitForRun(baseUrl: string, id: string): Promise<TestRun> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const run = await (await networkFetch(`${baseUrl}/api/runs/${id}`)).json() as TestRun;
    if (run.finishedAt) return run;
    await delay(30);
  }
  throw new Error('Run did not finish within the test deadline.');
}

test('configuration fails fast without credentials or distinct collections', () => {
  assert.throws(() => readConfig({}), /PINQLOQ_SECRET_KEY/);
  assert.throws(() => readConfig({ PINQLOQ_SECRET_KEY: 'fake' }), /two distinct/);
});

test('UI, health and polling do not produce logs or expose credentials', async () => {
  const sample = await fixture();
  try {
    for (const path of ['/', '/assets/app.js', '/api/config', '/api/runs', '/health']) {
      const response = await networkFetch(sample.baseUrl + path);
      assert.equal(response.status, 200);
      assert.ok(!(await response.text()).includes(config.secretKey));
    }
    const invalid = await post(sample.baseUrl, '/api/runs', { kind: 'load', total: 99999 });
    assert.equal(invalid.status, 400);
    const direct = await post(sample.baseUrl, '/demo/http/200', { password: 'should-not-be-logged' });
    assert.equal(direct.status, 403);
    const foreign = await networkFetch(`${sample.baseUrl}/api/runs`, { method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: '{"kind":"manual","level":2}' });
    assert.equal(foreign.status, 403);
    await sample.close();
    assert.equal(sample.batches.length, 0);
  } finally { await sample.close(); }
});

test('100 logs use bulk delivery with balanced statuses, levels and collections', async () => {
  const sample = await fixture();
  try {
    const response = await post(sample.baseUrl, '/api/runs', { kind: 'load', total: 100 });
    assert.equal(response.status, 202);
    const initial = await response.json() as TestRun;
    const run = await waitForRun(sample.baseUrl, initial.id);
    assert.equal(run.state, 'complete');
    assert.equal(run.generated, 100);
    assert.equal(run.accepted, 100);
    assert.equal(run.dropped, 0);
    assert.equal(run.manualSent, 50);
    assert.equal(run.manualFailed, 0);
    assert.deepEqual(run.httpStatuses, { 200: 10, 400: 10, 401: 10, 404: 10, 500: 10 });
    assert.equal(sample.batches.length, 2);
    assert.ok(run.batches[0].startedMs >= 1900);
    for (const batch of sample.batches) assert.equal(batch.logs.length, 50);
    const manual = sample.batches.find(batch => batch.collectionName === config.manualCollection);
    assert.ok(manual);
    for (const level of [1, 2, 3, 4, 5]) assert.equal(manual.logs.filter(log => log.logLevel === level).length, 10);
    const automatic = sample.batches.find(batch => batch.collectionName === config.httpCollection);
    assert.ok(automatic);
    for (const log of automatic.logs) {
      assert.equal(log.metadata.testRun, run.id);
      assert.equal(log.correlationId, run.id);
      const input = JSON.parse(log.detail.InputJson);
      assert.equal(input.password, MASK);
      assert.equal(input.taxNumber, MASK);
      assert.equal(JSON.parse(log.detail.RequestHeaders)['x-sample-internal'], MASK);
      const expectedLevel = Number(log.metadata.statusCode) >= 500 ? 4 : Number(log.metadata.statusCode) >= 400 ? 3 : 2;
      assert.equal(log.logLevel, expectedLevel);
    }
  } finally { await sample.close(); }
});

test('field and endpoint redaction preserve the intended visible data only', async () => {
  const sample = await fixture();
  try {
    for (const mode of ['fields', 'endpoint']) {
      const initial = await (await post(sample.baseUrl, '/api/runs', { kind: 'redaction', mode })).json() as TestRun;
      const run = await waitForRun(sample.baseUrl, initial.id);
      assert.equal(run.accepted, 1);
      const log = sample.batches.at(-1)?.logs[0];
      assert.ok(log);
      const output = JSON.parse(log.detail.OutputJson);
      assert.equal(output.accessToken, MASK);
      assert.equal(output.taxNumber, MASK);
      assert.equal(output.visible, mode === 'fields' ? 'example' : MASK);
      if (mode === 'endpoint') {
        assert.ok(Object.values(JSON.parse(log.detail.RequestHeaders)).every(value => value === MASK));
      }
    }
  } finally { await sample.close(); }
});

test('only one run executes and stopping still drains already generated logs', async () => {
  const sample = await fixture();
  try {
    const initial = await (await post(sample.baseUrl, '/api/runs', { kind: 'load', total: 1000 })).json() as TestRun;
    const conflicting = await post(sample.baseUrl, '/api/runs', { kind: 'manual', level: 2 });
    assert.equal(conflicting.status, 409);
    await post(sample.baseUrl, `/api/runs/${initial.id}/stop`, {});
    const run = await waitForRun(sample.baseUrl, initial.id);
    assert.equal(run.state, 'stopped');
    assert.ok(run.generated > 0 && run.generated < 1000);
    assert.equal(run.accepted, run.generated);
  } finally { await sample.close(); }
});

test('shutdown waits for the SDK in-flight delivery', async () => {
  let release = () => {};
  let signalStarted = () => {};
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const sample = await fixture(async batch => {
    signalStarted();
    await waiting;
    return Response.json({ accepted: true, acceptedCount: batch.logs.length });
  });
  try {
    const initial = await (await post(sample.baseUrl, '/api/runs', { kind: 'manual', level: 4 })).json() as TestRun;
    await started;
    let closed = false;
    const closing = sample.close().then(() => { closed = true; });
    await delay(30);
    assert.equal(closed, false);
    release();
    await closing;
    assert.equal(sample.store.get(initial.id)?.accepted, 1);
  } finally { release(); await sample.close(); }
});

test('partial API acknowledgement is not reported as complete delivery', async () => {
  const sample = await fixture(async () => Response.json({ accepted: true, acceptedCount: 0 }));
  try {
    const initial = await (await post(sample.baseUrl, '/api/runs', { kind: 'manual', level: 2 })).json() as TestRun;
    const run = await waitForRun(sample.baseUrl, initial.id);
    assert.equal(run.state, 'failed');
    assert.equal(run.accepted, 0);
    assert.equal(run.manualSent, 1);
    assert.equal(run.batches[0].result, 'partial');
  } finally { await sample.close(); }
});

test('HTTP rejection is recorded as failed delivery', async () => {
  const sample = await fixture(async () => new Response('Rejected test request', { status: 403 }));
  try {
    const initial = await (await post(sample.baseUrl, '/api/runs', { kind: 'manual', level: 2 })).json() as TestRun;
    const run = await waitForRun(sample.baseUrl, initial.id);
    assert.equal(run.state, 'failed');
    assert.equal(run.manualFailed, 1);
    assert.equal(run.batches[0].status, 403);
    assert.equal(run.accepted, 0);
    assert.equal(sample.store.connection.isConnected, true);
  } finally { await sample.close(); }
});
