import express, { type RequestHandler } from 'express';
import type { PinqloqClient } from 'pinqloq';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { SampleConfig } from './config.js';
import { validateSessionInput } from './config.js';
import { observeDelivery } from './delivery.js';
import { RunStore, parseScenario } from './runs.js';
import { configurePinqloq } from './pinqloq.js';
import { generate } from './generate.js';
import { HttpStatus, SDK_DEFAULTS } from './constants.js';

interface PinqloqSession {
  client: PinqloqClient | null;
  httpCollection: string;
  manualCollection: string;
  requestLogging: RequestHandler | null;
}

export async function startSample(config: SampleConfig, transport: typeof fetch = globalThis.fetch) {
  const store = new RunStore();
  const restoreDelivery = observeDelivery(store, transport);
  const session: PinqloqSession = { client: null, httpCollection: '', manualCollection: '', requestLogging: null };

  const internalKey = randomUUID();
  const app = express();
  app.disable('x-powered-by');
  let baseUrl = '';
  let closing = false;
  let generation: Promise<void> = Promise.resolve();

  app.use((request, response, next) => {
    if (closing && request.get('x-sample-internal') !== internalKey) { response.status(HttpStatus.Unavailable).json({ error: 'Sample is shutting down.' }); return; }
    const origin = request.get('origin');
    if (origin && origin !== baseUrl && origin !== `http://localhost:${new URL(baseUrl).port}`) {
      response.status(HttpStatus.Forbidden).json({ error: 'Use the local sample page.' }); return;
    }
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.get('/api/config', (_request, response) => {
    response.json({
      configured: session.client !== null,
      httpCollection: session.httpCollection, manualCollection: session.manualCollection,
      ...SDK_DEFAULTS
    });
  });
  app.post('/api/session', (request, response) => {
    let input;
    try {
      input = validateSessionInput(request.body);
    } catch (error) {
      response.status(HttpStatus.BadRequest).json({ error: (error as Error).message });
      return;
    }
    const previousClient = session.client;
    const client = configurePinqloq(input, store);
    session.client = client;
    session.httpCollection = input.httpCollection;
    session.manualCollection = input.manualCollection;
    session.requestLogging = client.requestLogging({
      excludePaths: ['/api', '/health', '/assets', '/favicon.ico'],
      redactFields: ['taxNumber', 'x-sample-internal'],
      redactPaths: ['/demo/redaction/endpoint'],
      metadata: { testRun: request => request.get('correlation-id') },
      resolveDeviceIdentifier: request => request.get('correlation-id')
    });
    if (previousClient) previousClient.shutdown().catch(error => console.error('Pinqloq: previous client shutdown failed.', error));
    response.json({ configured: true, httpCollection: input.httpCollection, manualCollection: input.manualCollection });
  });
  app.get('/health', (_request, response) => response.json({ status: 'ready', ingest: store.connection }));
  app.get('/api/runs', (_request, response) => response.json(store.list()));
  app.get('/api/runs/:id', (request, response) => {
    const run = store.get(request.params.id);
    if (!run) { response.status(HttpStatus.NotFound).json({ error: 'Test not found.' }); return; }
    response.json(run);
  });
  app.post('/api/runs', (request, response) => {
    if (!session.client) { response.status(HttpStatus.Unavailable).json({ error: 'Connect the SDK first.' }); return; }
    const scenario = parseScenario(request.body);
    if (!scenario) { response.status(HttpStatus.BadRequest).json({ error: 'Choose a supported test scenario.' }); return; }
    if (store.active) { response.status(HttpStatus.Conflict).json({ error: 'Wait for the current test to drain.' }); return; }
    const run = store.create(scenario);
    generation = generate(run, { baseUrl, internalKey, manualCollection: session.manualCollection, logger: session.client.logger, transport }).catch(error => {
      console.error('Sample test generation failed.', error);
      run.errors.push('Test generation failed. Check the server terminal.');
    }).finally(() => {
      run.generationDone = true;
      store.update(run);
    });
    response.status(HttpStatus.Accepted).json(run);
  });
  app.post('/api/runs/:id/stop', (request, response) => {
    const run = store.get(request.params.id);
    if (!run) { response.status(HttpStatus.NotFound).json({ error: 'Test not found.' }); return; }
    if (!run.finishedAt) run.stopRequested = true;
    response.json(run);
  });

  app.use('/demo', (request, response, next) => {
    if (request.get('x-sample-internal') !== internalKey || request.get('correlation-id') !== store.active?.id) {
      response.status(HttpStatus.Forbidden).json({ error: 'Start scenarios through /api/runs.' }); return;
    }
    next();
  });
  app.use((request, response, next) => {
    if (request.path.startsWith('/demo/') && session.requestLogging) session.requestLogging(request, response, next);
    else next();
  });
  app.post('/demo/http/:status', (request, response) => {
    const status = Number(request.params.status);
    const outcome = status < HttpStatus.BadRequest ? 'success' : 'error';
    response.status(status).json({ simulated: true, outcome });
  });
  app.post('/demo/redaction/:mode', (_request, response) => {
    response.json({ synthetic: true, accessToken: 'synthetic-access-token', taxNumber: 'synthetic-tax-number', visible: 'example' });
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((_request, response) => response.status(HttpStatus.NotFound).json({ error: 'Route not found.' }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error('Sample request failed.', error);
    response.status(HttpStatus.BadRequest).json({ error: 'Invalid request.' });
  });

  let server: Server;
  try {
    server = await new Promise<Server>((resolve, reject) => {
      const listener = app.listen(config.port, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
  } catch (error) {
    restoreDelivery();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not resolve the sample port.');
  baseUrl = `http://127.0.0.1:${address.port}`;

  let shutdown: Promise<void> | undefined;
  function close(): Promise<void> {
    if (shutdown) return shutdown;
    closing = true;
    if (store.active) store.active.stopRequested = true;
    shutdown = (async () => {
      await generation;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      try { if (session.client) await session.client.shutdown(); } finally { restoreDelivery(); }
    })();
    return shutdown;
  }
  return { baseUrl, close, store };
}
