export interface SampleConfig {
  port: number;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): SampleConfig {
  const port = Number(environment.PORT || 3100);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid port number.');
  return { port };
}

export interface PinqloqSessionInput {
  secretKey: string;
  httpCollection: string;
  manualCollection: string;
}

export function validateSessionInput(body: unknown): PinqloqSessionInput {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const secretKey = typeof record.secretKey === 'string' ? record.secretKey.trim() : '';
  const httpCollection = typeof record.httpCollection === 'string' ? record.httpCollection.trim() : '';
  const manualCollection = typeof record.manualCollection === 'string' ? record.manualCollection.trim() : '';
  if (!secretKey || !httpCollection || !manualCollection) {
    throw new Error('secretKey, httpCollection and manualCollection are all required.');
  }
  if (httpCollection === manualCollection) {
    throw new Error('httpCollection and manualCollection must be different.');
  }
  return { secretKey, httpCollection, manualCollection };
}
