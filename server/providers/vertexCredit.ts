import type { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { maskFailureText } from './failureReason';
import { sendOwnerTelegram } from './ownerTelegram';

/**
 * One gate for every Vertex call of a process (owner 04.11). The welcome credit of Vertex burns out
 * about 09.11, so Vertex Gemini is the FIRST stage of the chains while it lasts. When it ends Google
 * may not refuse but quietly charge the card, hence a hard ceiling counted from the shared ledger
 * (`bulk_llm_spend`, `provider='gemini'`), the same for the three processes.
 *
 * The ceiling is hard to within the calls running in parallel at that moment: no holds are placed,
 * on purpose (a hold per call would cost a write lock on a 3.8 GB database for a few cents).
 * A skipped, refused or cooling Vertex never stops anything: the stage fails and the chain goes on to
 * OpenRouter (28.10: one Vertex call over a reserve closed the whole background for hours).
 */
export const VERTEX_CATALOG_SUMMARY_TASK = 'catalog-ru-summary'; // same as CATALOG_RU_SUMMARY_TASK
const DEFAULTS = {
  creditUsd: 60,
  since: '2026-11-04',
  until: '2026-11-09',
  dayUsd: 20,
  catalogSummaryDayUsd: 5,
} as const;
const BILLING_OFF_MS = 6 * 3_600_000;
const COOL_BASE_MS = 60_000;
const COOL_MAX_MS = 300_000;
/** Failures in a row from which a cooling is an outage, not a blip: a patient call stops passing it. */
const OUTAGE_FAILURES = 4;
const SKIP_LOG_EVERY_MS = 60_000;
export const BILLING_OFF_EVENT = 'vertex_billing_off';

export interface VertexCreditConfig {
  /** Total spend allowed from `sinceIso` on. */
  readonly creditUsd: number;
  /** ISO instant (UTC) the total is counted from; compared with `created_at`. */
  readonly sinceIso: string;
  /** From this instant Vertex is skipped. */
  readonly untilMs: number;
  /** All mechanics together per UTC day. */
  readonly dayUsd: number;
  /** Own cap of the `catalog-ru-summary` task per UTC day. */
  readonly catalogSummaryDayUsd: number;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z)?$/u;

function readInstant(raw: string | undefined): number | undefined {
  const value = raw?.trim();
  if (!value || !INSTANT.test(value)) return undefined;
  const ms = Date.parse(value.includes('T') ? value : `${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value.slice(0, 10))
    ? ms
    : undefined;
}

/** Read once at start; a missing value is the default quietly, a bad one the default with a journal line. */
export function readVertexCreditConfig(
  env: Record<string, string | undefined>,
  warn: (line: string) => void = console.warn,
): VertexCreditConfig {
  const bad = (key: string) =>
    warn(`bulk-llm vertex-credit-invalid key=${key} value ignored, default used`);
  const money = (key: string, fallback: number): number => {
    const raw = env[key]?.trim();
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
    bad(key);
    return fallback;
  };
  const instant = (key: string, fallback: string): number => {
    const raw = env[key]?.trim();
    if (raw === undefined || raw === '') return Date.parse(`${fallback}T00:00:00Z`);
    const ms = readInstant(raw);
    if (ms !== undefined) return ms;
    bad(key);
    return Date.parse(`${fallback}T00:00:00Z`);
  };
  return {
    creditUsd: money('OPENQAREER_VERTEX_CREDIT_USD', DEFAULTS.creditUsd),
    sinceIso: new Date(instant('OPENQAREER_VERTEX_CREDIT_SINCE', DEFAULTS.since)).toISOString(),
    untilMs: instant('OPENQAREER_VERTEX_CREDIT_UNTIL', DEFAULTS.until),
    dayUsd: money('OPENQAREER_VERTEX_DAY_USD', DEFAULTS.dayUsd),
    catalogSummaryDayUsd: money(
      'OPENQAREER_VERTEX_CATALOG_SUMMARY_DAY_USD',
      DEFAULTS.catalogSummaryDayUsd,
    ),
  };
}

export type VertexSkipReason =
  'credit_spent' | 'credit_expired' | 'day_cap' | 'task_day_cap' | 'billing_off' | 'cooling';

/** The stage is not asked: the chain treats it like any failed stage. */
export class VertexSkippedError extends Error {
  constructor(readonly reason: VertexSkipReason) {
    super(`vertex skipped: ${reason}`);
    this.name = 'VertexSkippedError';
  }
}

const BILLING_WORDS = /\b(billing|credits?|prepayment|budget)\b/iu;

/**
 * Billing refusals (real Google texts were never observed, so this goes by signs): 402; 403 that
 * names billing; 429 or RESOURCE_EXHAUSTED that names billing, credit, prepayment or budget.
 * Everything else, a plain quota 429 or a permission 403 included, is an ordinary refusal.
 */
export function classifyVertexFailure(
  status: number | undefined,
  text: string,
): 'billing' | 'ordinary' {
  if (status === 402) return 'billing';
  if (status === 403 && (/BILLING_DISABLED/u.test(text) || BILLING_WORDS.test(text)))
    return 'billing';
  const exhausted = status === 429 || /RESOURCE_EXHAUSTED/u.test(text);
  return exhausted && BILLING_WORDS.test(text) ? 'billing' : 'ordinary';
}

/** Refusals that say Vertex itself is unwell: they cool it. A 400 is the caller's request, not Vertex. */
function coolsStage(status: number | undefined): boolean {
  return (
    status === undefined || status === 403 || status === 408 || status === 429 || status >= 500
  );
}

const ALERTS: Partial<Record<VertexSkipReason, string>> = {
  credit_spent:
    'openqareer: стартовый кредит Vertex потрачен до предела, который мы задали. Дорогая модель Gemini отключена, работа идёт через OpenRouter. Если кредит ещё есть, поднимите OPENQAREER_VERTEX_CREDIT_USD.',
  credit_expired:
    'openqareer: срок стартового кредита Vertex вышел. Gemini на Vertex больше не вызывается, работа идёт через OpenRouter.',
  day_cap:
    'openqareer: Vertex Gemini израсходовал дневной предел. До полуночи UTC работа идёт через OpenRouter.',
};
const BILLING_ALERT =
  'openqareer: Google отказал Vertex из-за оплаты (кредит кончился или биллинг выключен). Vertex отключён на 6 часов, работа идёт через OpenRouter. Проверьте биллинг проекта.';

export interface VertexGateOptions {
  readonly ledger: Pick<
    SqliteBulkLlmLedger,
    'vertexSpend' | 'eventSince' | 'event' | 'firstToday'
  > &
    Partial<SqliteBulkLlmLedger>;
  readonly config: VertexCreditConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly transport?: typeof fetch;
  readonly now?: () => number;
  /** Journal line sink; defaults to `console.warn`. */
  readonly log?: (line: string) => void;
}

export interface VertexGate {
  readonly ledger: VertexGateOptions['ledger'];
  /** Why Vertex may not be called now, or undefined. */
  skipReason(task: string, patient?: boolean): VertexSkipReason | undefined;
  /** Throws `VertexSkippedError` (and reports it) when Vertex may not be called. */
  admit(task: string, patient?: boolean): void;
  /** A refusal or a transport failure: billing switches Vertex off for hours, the rest cools it here. */
  failed(failure: { status?: number; text: string }): void;
  succeeded(): void;
}

export function createVertexGate(options: VertexGateOptions): VertexGate {
  return new CreditGate(options);
}

class CreditGate implements VertexGate {
  readonly ledger: VertexGateOptions['ledger'];
  private readonly config: VertexCreditConfig;
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private coolUntil = 0;
  private failures = 0;
  private billingOffUntil = 0;
  private lastSkipLogAt = Number.NEGATIVE_INFINITY;

  constructor(options: VertexGateOptions) {
    this.ledger = options.ledger;
    this.config = options.config;
    this.env = options.env ?? process.env;
    this.transport = options.transport ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line: string) => console.warn(line));
  }

  private billingOff(): boolean {
    if (this.billingOffUntil > this.now()) return true;
    return this.ledger.eventSince(
      BILLING_OFF_EVENT,
      new Date(this.now() - BILLING_OFF_MS).toISOString(),
    );
  }

  skipReason(task: string, patient = false): VertexSkipReason | undefined {
    const { config } = this;
    if (this.now() >= config.untilMs) return 'credit_expired';
    if (this.billingOff()) return 'billing_off';
    if (this.coolUntil > this.now() && !(patient && this.failures < OUTAGE_FAILURES)) return 'cooling';
    const spent = this.ledger.vertexSpend({
      sinceIso: config.sinceIso,
      dayStartIso: `${new Date(this.now()).toISOString().slice(0, 10)}T00:00:00.000Z`,
      task,
    });
    if (spent.creditUsd >= config.creditUsd) return 'credit_spent';
    if (spent.dayUsd >= config.dayUsd) return 'day_cap';
    if (task === VERTEX_CATALOG_SUMMARY_TASK && spent.taskDayUsd >= config.catalogSummaryDayUsd)
      return 'task_day_cap';
    return undefined;
  }

  private alertOnce(kind: string, text: string) {
    try {
      if (!this.ledger.firstToday(`owner_alert_${kind}`)) return;
      sendOwnerTelegram(this.env, this.transport, text);
    } catch (error) {
      console.error(
        `bulk-llm vertex-alert-failed ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  admit(task: string, patient = false) {
    const reason = this.skipReason(task, patient);
    if (!reason) return;
    if (this.now() - this.lastSkipLogAt >= SKIP_LOG_EVERY_MS) {
      this.lastSkipLogAt = this.now();
      this.log(`bulk-llm vertex-skip reason=${reason}`);
    }
    const alert = ALERTS[reason];
    if (alert) this.alertOnce(`vertex_${reason}`, alert);
    throw new VertexSkippedError(reason);
  }

  failed(failure: { status?: number; text: string }) {
    const text = maskFailureText(failure.text);
    if (classifyVertexFailure(failure.status, text) === 'billing') {
      this.switchBillingOff(text);
      return;
    }
    if (failure.status === 403) this.log(`bulk-llm vertex-forbidden reason=${text}`);
    if (!coolsStage(failure.status)) return;
    // 05.11: Vertex остывал после отказа без причины в журнале, и её нельзя было установить.
    if (failure.status !== 403) this.log(`bulk-llm vertex-refused status=${failure.status ?? 'none'} reason=${text}`);
    this.failures += 1;
    this.coolUntil = this.now() + Math.min(COOL_BASE_MS * 2 ** (this.failures - 1), COOL_MAX_MS);
  }

  private switchBillingOff(text: string) {
    this.billingOffUntil = this.now() + BILLING_OFF_MS;
    this.log(`bulk-llm vertex-billing-off reason=${text}`);
    try {
      this.ledger.event(BILLING_OFF_EVENT);
    } catch (error) {
      console.error(
        `bulk-llm vertex-billing-event-failed ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
    this.alertOnce('vertex_billing_off', BILLING_ALERT);
  }

  succeeded() {
    this.failures = 0;
    this.coolUntil = 0;
  }
}
