// ── Pipeline Debug Tracer ──────────────────────────────────────
// Single-match pipeline debug tracer. Captures every step of the
// signal generation pipeline: raw data → calculations → signal decision.
//
// Usage:
//   const tracer = new PipelineTracer(matchCode, 'Team A', 'Team B', 'L1');
//   tracer.step('fetch_raw', { input }, { output });
//   await tracer.save('completed');

import { db } from './db';

export interface TraceStep {
  name: string;
  duration: number;  // ms
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  timestamp: number;
}

export class PipelineTracer {
  public matchCode: number;
  public homeTeam: string;
  public awayTeam: string;
  public league: string;
  private steps: TraceStep[] = [];
  private stepStart = Date.now();

  constructor(matchCode: number, homeTeam: string = '', awayTeam: string = '', league: string = '') {
    this.matchCode = matchCode;
    this.homeTeam = homeTeam;
    this.awayTeam = awayTeam;
    this.league = league;
  }

  /** Begin timing a new step. Call stepEnd() afterward. */
  stepBegin(): void {
    this.stepStart = Date.now();
  }

  /** End the current step and push into trace. */
  stepEnd(name: string, input: Record<string, unknown>, output: Record<string, unknown>, error?: string): void {
    const duration = Date.now() - this.stepStart;
    this.steps.push({
      name,
      duration,
      input,
      output,
      error,
      timestamp: Date.now(),
    });
  }

  /** Simpler one-call step (timing starts/stops internally). */
  step(name: string, input: Record<string, unknown>, output: Record<string, unknown>, error?: string): void {
    this.steps.push({
      name,
      duration: 0,
      input,
      output,
      error,
      timestamp: Date.now(),
    });
  }

  getSteps(): TraceStep[] {
    return this.steps;
  }

  async save(status: 'completed' | 'error' = 'completed', errorMsg?: string): Promise<string> {
    try {
      const row = await db.pipelineTrace.create({
        data: {
          matchCode: this.matchCode,
          homeTeam: this.homeTeam || null,
          awayTeam: this.awayTeam || null,
          league: this.league || null,
          status,
          traceData: this.steps as any,
          error: errorMsg || null,
          completedAt: new Date(),
        },
      });
      return row.id;
    } catch (e) {
      return '';
    }
  }
}
