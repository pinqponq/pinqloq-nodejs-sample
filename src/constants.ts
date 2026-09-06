export const SAMPLE_VERSION = 'sample-0.1.0';
export const SAMPLE_DEVICE = 'pinqloq-nodejs-sample';
export const INGEST_URL = 'https://pinqloq-external-api.pinqponq.io/api/client-logs/bulk';
export const LOCAL_REQUEST_TIMEOUT_MS = 10000;
export const CONCURRENCY = 10;
export const GENERATION_INTERVAL_MS = 100;
export const SDK_DEFAULTS = { batchSize: 200, flushIntervalMs: 2000, queueCapacity: 10000 } as const;

export enum HttpStatus {
  Success = 200,
  Accepted = 202,
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  Conflict = 409,
  ServerError = 500,
  Unavailable = 503
}
