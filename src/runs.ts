import { randomUUID } from 'node:crypto';
import { PinqloqLogLevel } from 'pinqloq';
import { HttpStatus } from './constants.js';

export const HTTP_STATUSES = [HttpStatus.Success, HttpStatus.BadRequest, HttpStatus.Unauthorized, HttpStatus.NotFound, HttpStatus.ServerError] as const;
export const LOG_LEVELS = [PinqloqLogLevel.Debug, PinqloqLogLevel.Information, PinqloqLogLevel.Warning, PinqloqLogLevel.Error, PinqloqLogLevel.Fatal] as const;
export const LOAD_SIZES = [100, 1000] as const;
const HISTORY_LIMIT = 30;

export type Scenario =
  | { kind: 'http'; status: number }
  | { kind: 'manual'; level: number }
  | { kind: 'redaction'; mode: 'fields' | 'endpoint' }
  | { kind: 'load'; total: number };

export interface BulkRecord {
  collection: string;
  count: number;
  startedMs: number;
  durationMs?: number;
  status?: number;
  acceptedCount?: number;
  result: 'pending' | 'accepted' | 'partial' | 'unknown' | 'failed';
}

export interface TestRun {
  id: string;
  scenario: Scenario;
  startedAt: string;
  finishedAt?: string;
  generationDone: boolean;
  stopRequested: boolean;
  state: 'generating' | 'draining' | 'complete' | 'stopped' | 'failed';
  planned: number;
  generated: number;
  queued: number;
  dropped: number;
  submitted: number;
  settled: number;
  accepted: number;
  manualSent: number;
  manualFailed: number;
  httpStatuses: Record<string, number>;
  errors: string[];
  batches: BulkRecord[];
}

export class RunStore {
  private readonly runs = new Map<string, TestRun>();
  readonly connection: { isConnected: boolean | null; lastHttpStatus?: number; lastCheckedAt?: string } = { isConnected: null };

  get active(): TestRun | undefined {
    return [...this.runs.values()].find(run => !run.finishedAt);
  }

  get(id: string): TestRun | undefined { return this.runs.get(id); }
  list(): TestRun[] { return [...this.runs.values()].reverse(); }

  create(scenario: Scenario): TestRun {
    if (this.active) throw new Error('A test is already running.');
    const oldest = this.runs.keys().next().value;
    if (this.runs.size >= HISTORY_LIMIT && oldest) this.runs.delete(oldest);
    const id = `sample-${randomUUID()}`;
    const planned = scenario.kind === 'load' ? scenario.total : 1;
    const startedAt = new Date().toISOString();
    const run: TestRun = {
      id, scenario, startedAt, planned, generationDone: false, stopRequested: false,
      state: 'generating', generated: 0, queued: 0, dropped: 0, submitted: 0,
      settled: 0, accepted: 0, manualSent: 0, manualFailed: 0,
      httpStatuses: {}, errors: [], batches: []
    };
    this.runs.set(id, run);
    return run;
  }

  update(run: TestRun): void {
    if (!run.generationDone) return;
    run.state = 'draining';
    if (run.settled + run.dropped < run.generated) return;
    const hasFailure = run.errors.length > 0 || run.dropped > 0 || run.accepted < run.queued;
    run.state = hasFailure ? 'failed' : run.stopRequested ? 'stopped' : 'complete';
    run.finishedAt = new Date().toISOString();
  }
}

export function parseScenario(body: unknown): Scenario | undefined {
  if (!body || typeof body !== 'object') return;
  const value = body as Record<string, unknown>;
  if (typeof value.status === 'number' && value.kind === 'http' && HTTP_STATUSES.some(status => status === value.status)) return { kind: 'http', status: value.status };
  if (typeof value.level === 'number' && value.kind === 'manual' && LOG_LEVELS.some(level => level === value.level)) return { kind: 'manual', level: value.level };
  if (typeof value.total === 'number' && value.kind === 'load' && LOAD_SIZES.some(total => total === value.total)) return { kind: 'load', total: value.total };
  if (value.kind === 'redaction' && (value.mode === 'fields' || value.mode === 'endpoint')) return { kind: 'redaction', mode: value.mode };
}
