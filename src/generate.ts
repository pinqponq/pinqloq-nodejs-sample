import { setTimeout as delay } from 'node:timers/promises';
import { PinqloqLogLevel, type PinqloqLogger } from 'pinqloq';
import { CONCURRENCY, GENERATION_INTERVAL_MS, LOCAL_REQUEST_TIMEOUT_MS } from './constants.js';
import { HTTP_STATUSES, LOG_LEVELS, type TestRun } from './runs.js';

export interface GenerationContext {
  baseUrl: string;
  internalKey: string;
  manualCollection: string;
  logger: PinqloqLogger;
  transport: typeof fetch;
}

function logManual(run: TestRun, context: GenerationContext, level: number, sequence: number): void {
  const event = `sample.manual.${PinqloqLogLevel[level].toLowerCase()}`;
  const sequenceValue = String(sequence);
  context.logger.enqueue({
    event, logLevel: level, deviceIdentifier: run.id, correlationId: run.id,
    collectionName: context.manualCollection,
    metadata: { testRun: run.id, sequence: sequenceValue, synthetic: 'true' },
    detail: { message: 'Synthetic sample event. No personal data.' }
  }, () => { run.manualSent++; }, () => { run.manualFailed++; });
}

async function callDemo(run: TestRun, context: GenerationContext, path: string, sequence = 0): Promise<void> {
  const body = JSON.stringify({ synthetic: true, sequence, password: 'synthetic-password', taxNumber: 'synthetic-tax-number' });
  const signal = AbortSignal.timeout(LOCAL_REQUEST_TIMEOUT_MS);
  const response = await context.transport(`${context.baseUrl}${path}`, {
    method: 'POST', headers: {
      'content-type': 'application/json', 'correlation-id': run.id,
      'x-sample-internal': context.internalKey
    }, body, signal
  });
  await response.text();
  const status = String(response.status);
  run.httpStatuses[status] = (run.httpStatuses[status] || 0) + 1;
}

export async function generate(run: TestRun, context: GenerationContext): Promise<void> {
  const scenario = run.scenario;
  if (scenario.kind === 'manual') { logManual(run, context, scenario.level, 0); return; }
  if (scenario.kind === 'http') { await callDemo(run, context, `/demo/http/${scenario.status}`); return; }
  if (scenario.kind === 'redaction') { await callDemo(run, context, `/demo/redaction/${scenario.mode}`); return; }
  const requestsToGenerate = scenario.total / 2;
  for (let offset = 0; offset < requestsToGenerate; offset += CONCURRENCY) {
    if (run.stopRequested) break;
    const pendingRequests: Promise<void>[] = [];
    for (let position = 0; position < CONCURRENCY; position++) {
      const sequence = offset + position;
      logManual(run, context, LOG_LEVELS[sequence % LOG_LEVELS.length], sequence);
      pendingRequests.push(callDemo(run, context, `/demo/http/${HTTP_STATUSES[sequence % HTTP_STATUSES.length]}`, sequence));
    }
    const results = await Promise.allSettled(pendingRequests);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    await delay(GENERATION_INTERVAL_MS);
  }
}
