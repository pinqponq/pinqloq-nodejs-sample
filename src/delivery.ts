import type { RunStore, BulkRecord } from './runs.js';
import { INGEST_URL } from './constants.js';

export function observeDelivery(store: RunStore, transport: typeof fetch = globalThis.fetch): () => void {
  const previousFetch = globalThis.fetch;
  const observedFetch: typeof fetch = async (input, options) => {
    if (String(input) !== INGEST_URL || typeof options?.body !== 'string') return transport(input, options);
    const payload = JSON.parse(options.body);
    const runId = payload.logs[0]?.metadata?.testRun;
    const run = store.get(runId);
    if (!run) return transport(input, options);
    const started = Date.now();
    const startedMs = started - Date.parse(run.startedAt);
    const record: BulkRecord = {
      collection: payload.collectionName, count: payload.logs.length,
      startedMs, result: 'pending'
    };
    run.batches.push(record);
    run.submitted += record.count;
    try {
      const response = await transport(input, options);
      store.connection.isConnected = true;
      store.connection.lastHttpStatus = response.status;
      record.status = response.status;
      if (!response.ok) {
        record.result = 'failed';
        run.errors.push(`Ingest HTTP ${response.status}`);
        return response;
      }
      const acknowledgement = await response.clone().json().catch(error => {
        console.warn('Could not decode the ingest acknowledgement.', error);
        return undefined;
      });
      const count = acknowledgement?.acceptedCount;
      if (acknowledgement?.accepted !== true || !Number.isInteger(count) || count < 0 || count > record.count) {
        record.result = 'unknown';
        run.errors.push('API acceptance count could not be verified.');
      } else {
        record.acceptedCount = count;
        record.result = count === record.count ? 'accepted' : 'partial';
        run.accepted += count;
      }
      return response;
    } catch (error) {
      store.connection.isConnected = false;
      record.result = 'failed';
      run.errors.push('Ingest delivery failed or timed out.');
      throw error;
    } finally {
      store.connection.lastCheckedAt = new Date().toISOString();
      record.durationMs = Date.now() - started;
      run.settled += record.count;
      store.update(run);
    }
  };
  globalThis.fetch = observedFetch;
  return () => {
    if (globalThis.fetch === observedFetch) globalThis.fetch = previousFetch;
  };
}
