/**
 * B763: шаг догона записей пула без кластера. Окно за такт, шаг не
 * накладывается сам на себя, после законченного прохода — час покоя, после
 * остановки обслуживания — ничего.
 */
/** 300 строк за такт в 2 с — проход пула (~1,9 млн строк) ≈ 3,5 ч, потом час покоя. */
export const UNCLUSTERED_CATCH_UP_CHUNK = 300;
const UNCLUSTERED_CATCH_UP_REST_MS = 60 * 60 * 1_000;

export interface UnclusteredCatchUpResult {
  readonly inspected: number;
  readonly clustered: number;
  readonly passFinished: boolean;
}

export type RunUnclusteredCatchUp = (chunk?: number) => Promise<UnclusteredCatchUpResult>;

interface CatchUpLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export class UnclusteredCatchUp {
  private restUntil = 0;
  private inFlight = false;

  constructor(
    private readonly engine: { readonly runUnclusteredCatchUpStep?: RunUnclusteredCatchUp },
    private readonly log: CatchUpLog,
    private readonly now: () => number,
    private readonly stopped: () => boolean,
  ) {}

  async run(): Promise<void> {
    const { engine, log } = this;
    if (!engine.runUnclusteredCatchUpStep || this.stopped() || this.inFlight) return;
    if (this.now() < this.restUntil) return;
    this.inFlight = true;
    try {
      const result = await engine.runUnclusteredCatchUpStep(UNCLUSTERED_CATCH_UP_CHUNK);
      if (result.clustered > 0) log.info({ ...result }, 'vacancy-unclustered-catch-up-tick');
      if (result.passFinished) this.restUntil = this.now() + UNCLUSTERED_CATCH_UP_REST_MS;
    } catch (error: unknown) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      log.error({ errorName }, 'vacancy-unclustered-catch-up-failed');
    } finally {
      this.inFlight = false;
    }
  }
}
