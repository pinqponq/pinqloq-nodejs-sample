export interface SampleConfig {
  secretKey: string;
  httpCollection: string;
  manualCollection: string;
  port: number;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): SampleConfig {
  const secretKey = environment.PINQLOQ_SECRET_KEY?.trim();
  const httpCollection = environment.PINQLOQ_HTTP_COLLECTION?.trim();
  const manualCollection = environment.PINQLOQ_MANUAL_COLLECTION?.trim();
  const port = Number(environment.PORT || 3100);
  if (!secretKey || secretKey === 'replace-with-your-project-secret-key') {
    throw new Error('Set PINQLOQ_SECRET_KEY in the server-side .env file.');
  }
  if (!httpCollection || !manualCollection || httpCollection === manualCollection) {
    throw new Error('Configure two distinct PINQLOQ_HTTP_COLLECTION and PINQLOQ_MANUAL_COLLECTION values.');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid port number.');
  return { secretKey, httpCollection, manualCollection, port };
}
