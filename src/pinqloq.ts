import { createPinqloq } from 'pinqloq';
import type { SampleConfig } from './config.js';
import type { RunStore } from './runs.js';
import { SAMPLE_DEVICE, SAMPLE_VERSION } from './constants.js';

export function configurePinqloq(config: SampleConfig, store: RunStore) {
  const client = createPinqloq({
    secretKey: config.secretKey,
    apiLogsCollectionName: config.httpCollection,
    deviceIdentifier: SAMPLE_DEVICE,
    appVersionName: SAMPLE_VERSION
  });
  const originalEnqueue = client.logger.enqueue.bind(client.logger);
  client.logger.enqueue = (entry, onSent, onFailed) => {
    const run = entry.metadata?.testRun ? store.get(entry.metadata.testRun) : undefined;
    if (run) run.generated++;
    const queued = originalEnqueue(entry, onSent, onFailed);
    if (run) {
      if (queued) run.queued++;
      else run.dropped++;
    }
    return queued;
  };
  return client;
}
