/**
 * B763: шаг догона записей пула без кластера. Окно за такт, шаг не
 * накладывается сам на себя, после законченного прохода — час покоя, после
 * остановки обслуживания — ничего.
 */
/**
 * Окно осмотра за такт. Такт на проде идёт раз в ~19 с, а не в 2 с: при 300 строках проход
 * 2,2 млн строк занимал ~40 ч. Осмотр дешёвый (ключи членства), дорого сведение — его
 * ограничивает `UNCLUSTERED_CATCH_UP_MAX_CLUSTERED`; при 1 000 проход ≈ 12 ч.
 */
export const UNCLUSTERED_CATCH_UP_CHUNK = 1_000;
/** B763 23.11: не больше 100 сведений за такт — одно сведение тянет поиск по компании и названию. */
export const UNCLUSTERED_CATCH_UP_MAX_CLUSTERED = 100;
const UNCLUSTERED_CATCH_UP_REST_MS = 60 * 60 * 1_000;

export interface UnclusteredCatchUpResult {
  readonly inspected: number;
  readonly clustered: number;
  readonly passFinished: boolean;
}

export type RunUnclusteredCatchUp = (
  chunk?: number,
  maxClustered?: number,
) => Promise<UnclusteredCatchUpResult>;

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
      const result = await engine.runUnclusteredCatchUpStep(
        UNCLUSTERED_CATCH_UP_CHUNK,
        UNCLUSTERED_CATCH_UP_MAX_CLUSTERED,
      );
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
