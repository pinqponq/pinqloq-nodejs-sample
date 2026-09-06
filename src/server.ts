import { startSample } from './app.js';
import { readConfig } from './config.js';

const sample = await startSample(readConfig());
console.log(`Pinqloq sample ready: ${sample.baseUrl}`);

async function stop() {
  try { await sample.close(); }
  catch (error) { console.error('Sample shutdown failed.', error); process.exitCode = 1; }
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
