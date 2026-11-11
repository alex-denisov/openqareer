import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ROLE_TAXONOMY, TAXONOMY_VERSION, type FunctionCode } from '../../../shared/roleTaxonomy';
import { ontology } from '../../../shared/roleOntology';
import { MIGRATION_35 } from '../../data/sqliteSchema';
import type { BulkLlmClient } from '../../providers/bulkLlmClient';
import { rulesParse } from './rulesParse';
import { isConfirmedNonItTitle } from './freehireClassify/classify';
import { describeFailure, ensureLastFailureColumn } from './titleFreeze';
import { notExcludedVacancyIdSql } from '../freehire/paidProcessingGate';

export interface TitleModelInput {
  readonly titleKey: string;
  readonly sampleTitle: string;
}

export interface TitleModelResult {
  readonly titleKey: string;
  readonly functions: readonly FunctionCode[];
  readonly levelRank: number | null;
  readonly roleId?: string;
}

/** Разобранные названия и модель, которая действительно ответила (не подпись цепочки). */
export interface TitleParseAnswer {
  readonly model: string;
  readonly results: readonly TitleModelResult[];
}

export interface ModelTitleParser {
  parse(items: readonly TitleModelInput[]): Promise<TitleParseAnswer>;
}

const FUNCTION_CODES = ROLE_TAXONOMY.map((entry) => entry.code);
const responseItemSchema = z
  .object({
    titleKey: z.string().min(1),
    functions: z.array(z.enum(FUNCTION_CODES)).min(1).max(2),
    levelRank: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.null(),
    ]),
    roleId: z.string().optional(),
  })
  .strict();

const SYSTEM_PROMPT = `
Разбери каждое название вакансии. Верни ровно по одной записи на titleKey.
functions содержит 1–2 кода только из списка: ${FUNCTION_CODES.join(', ')}.
levelRank — уровень должности по шкале: 0 — специалист любого грейда (junior…principal, senior, associate, analyst, engineer, manager без подчинённых руководителей); 1 — lead, team lead, senior manager, руководитель группы; 2 — head of, director, руководитель направления/отдела; 3 — VP, senior director, вице-президент; 4 — C-level (CEO, CTO, CIO, COO, CFO, генеральный/технический/финансовый директор). null — если уровень не определить.
Chief of Staff — 2, не 4.
roleId указывай только при уверенном соответствии роли из онтологии.
Не добавляй пояснений и не меняй titleKey.
`;

const TITLE_PARSE_TASK = 'title-parse';
const MAX_BATCH = 40;
const TITLE_MAX_TOKENS = 4_096;
const TITLE_PROMPT = `${SYSTEM_PROMPT}\nВерни JSON-объект {"items": [...]} с записями вида {titleKey, functions, levelRank, roleId?}.`;

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function titleParseRunId(now: number): string {
  return `${TITLE_PARSE_TASK}:${utcDay(now)}`;
}

/**
 * Разбор через фоновый канал: повторы, цепочка, журнал расхода и причины отказов ведёт
 * `BulkLlmClient`. Сбой канала (`BulkChannelUnavailable`, бюджет, отклонённый ответ) уходит
 * исключением; пачка с хотя бы одной годной записью — успех.
 */
export class BulkTitleParser implements ModelTitleParser {
  constructor(
    private readonly client: Pick<BulkLlmClient, 'complete'>,
    private readonly now: () => number = Date.now,
  ) {}

  async parse(items: readonly TitleModelInput[]): Promise<TitleParseAnswer> {
    if (items.length === 0) return { model: '', results: [] };
    if (items.length > MAX_BATCH) throw new Error('title model batch exceeds 40 items');
    const result = await this.client.complete({
      runId: titleParseRunId(this.now()),
      task: TITLE_PARSE_TASK,
      dataClass: 'public',
      prefix: TITLE_PROMPT,
      input: JSON.stringify(items),
      maxTokens: TITLE_MAX_TOKENS,
      accept: (content) => decodeTitleResults(safeJson(content), items).length > 0,
    });
    return { model: result.model, results: decodeTitleResults(safeJson(result.content), items) };
  }
}

/** Ответ модели: `{ items: [...] }` (допускается и голый массив). */
function decodeTitleResults(
  decoded: unknown,
  items: readonly TitleModelInput[],
): readonly TitleModelResult[] {
  const list = Array.isArray(decoded) ? decoded : (decoded as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return [];
  const allowedKeys = new Set(items.map((item) => item.titleKey));
  return list.flatMap((value) => {
    const parsed = responseItemSchema.safeParse(value);
    if (!parsed.success || !allowedKeys.has(parsed.data.titleKey)) return [];
    // Неизвестный или противоречащий функции roleId отбрасывается, разбор остаётся.
    const { roleId, ...rest } = parsed.data;
    const roleFunction = roleId ? ontology.rolesById.get(roleId)?.function : undefined;
    const keepRole =
      roleFunction !== undefined && rest.functions.includes(roleFunction as FunctionCode);
    return [keepRole ? { ...rest, roleId } : rest];
  });
}

export interface TitleModelStepReport {
  readonly batches: number;
  readonly parsed: number;
  readonly refused: number;
  readonly frozen: number;
  /** Названий, ушедших в модель за проход. */
  readonly titles: number;
  /** Названий в неполной пачке, которая ждёт таймера `maxWaitMs`. */
  readonly heldPartial: number;
  readonly callsToday: number;
  readonly dailyCapReached: boolean;
  /** Вызовов с запуска процесса (для потолка прогона) и признак сбоя вызова в этом проходе. */
  readonly callsRun: number;
  readonly runCeilingReached: boolean;
  readonly failedCall: boolean;
  readonly ms: number;
}

interface TitleModelStepOptions {
  readonly dailyCalls?: number;
  readonly maxBatches?: number;
  /** Потолок вызовов модели за жизнь процесса: останавливает перепрогон у бюджета. */
  readonly maxCallsPerRun?: number;
  /** Сколько неполная пачка (меньше 40) ждёт добора, мс. По умолчанию 30 минут. */
  readonly maxWaitMs?: number;
  readonly log?: { warn(fields: Record<string, unknown>, message: string): void };
  readonly now?: () => number;
}

export const DEFAULT_PARTIAL_BATCH_WAIT_MS = 30 * 60_000;

interface PassTally {
  batches: number;
  parsed: number;
  refused: number;
  frozen: number;
  titles: number;
  heldPartial: number;
  failedCall: boolean;
}

export class TitleModelStep {
  private readonly dailyCalls: number;
  private readonly maxBatches: number;
  private readonly now: () => number;
  private readonly maxCallsPerRun: number;
  private readonly maxWaitMs: number;
  private readonly log: TitleModelStepOptions['log'];
  private callsRun = 0;
  private pausedUntil = 0;
  private consecutiveFailures = 0;
  /**
   * Когда шаг впервые увидел неполную пачку. Только в памяти: перезапуск сбрасывает отсчёт, и
   * неполная пачка ждёт ещё `maxWaitMs`; название при этом не теряется — оно в очереди в SQLite.
   */
  private partialSince: number | null = null;

  constructor(
    private readonly database: DatabaseSync,
    private readonly parser: ModelTitleParser,
    options: TitleModelStepOptions = {},
  ) {
    this.dailyCalls = options.dailyCalls ?? 2_000;
    this.maxBatches = options.maxBatches ?? 3;
    this.now = options.now ?? Date.now;
    this.maxCallsPerRun = options.maxCallsPerRun ?? Number.POSITIVE_INFINITY;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_PARTIAL_BATCH_WAIT_MS;
    this.log = options.log;
    this.database.exec(MIGRATION_35);
    ensureLastFailureColumn(this.database);
  }

  async run(): Promise<TitleModelStepReport> {
    const startedAt = this.now();
    const tally: PassTally = {
      batches: 0,
      parsed: 0,
      refused: 0,
      frozen: 0,
      titles: 0,
      heldPartial: 0,
      failedCall: false,
    };
    if (startedAt < this.pausedUntil) return this.report(tally, startedAt, 0);
    this.seedQueue(500);
    const daily = this.dailyState();
    while (
      tally.batches < this.maxBatches &&
      daily.calls + tally.batches < this.dailyCalls &&
      this.callsRun < this.maxCallsPerRun
    ) {
      const items = this.nextBatch();
      if (!this.shouldSend(items, tally)) break;
      await this.sendBatch(items, tally);
      if (tally.failedCall) break;
    }
    if (tally.batches > 0) this.addCalls(daily.day, tally.batches);
    return this.report(tally, startedAt, daily.calls);
  }

  /** Полная пачка уходит сразу; неполная ждёт добора до `maxWaitMs` с первого её появления. */
  private shouldSend(items: readonly TitleModelInput[], tally: PassTally): boolean {
    if (items.length === 0) {
      this.partialSince = null;
      return false;
    }
    if (items.length >= MAX_BATCH) return true;
    const now = this.now();
    this.partialSince ??= now;
    if (now - this.partialSince >= this.maxWaitMs) return true;
    tally.heldPartial = items.length;
    return false;
  }

  private async sendBatch(items: readonly TitleModelInput[], tally: PassTally): Promise<void> {
    const partial = items.length < MAX_BATCH;
    const outcome = await this.tryParse(items);
    tally.batches += 1;
    tally.titles += items.length;
    this.callsRun += 1;
    if (!outcome.ok) {
      tally.failedCall = true;
      return;
    }
    this.consecutiveFailures = 0;
    if (partial) this.partialSince = null;
    const applied = this.apply(items, outcome.answer);
    tally.parsed += applied.parsed;
    tally.refused += applied.refused;
    tally.frozen += applied.frozen;
  }

  private report(tally: PassTally, startedAt: number, dailyBefore: number): TitleModelStepReport {
    const callsToday = dailyBefore + tally.batches;
    const atCap = callsToday >= this.dailyCalls;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return {
      ...tally,
      callsToday,
      dailyCapReached: atCap && this.markCapLogged(day),
      callsRun: this.callsRun,
      runCeilingReached: this.callsRun >= this.maxCallsPerRun,
      ms: this.now() - startedAt,
    };
  }

  private seedQueue(limit: number): void {
    const rows = this.database
      .prepare(
        `SELECT p.title_key, p.sample_title FROM title_parse p INDEXED BY title_parse_queue
       WHERE p.parsed_by = 'rules' AND NOT EXISTS (
         SELECT 1 FROM title_parse_model_queue q WHERE q.title_key = p.title_key
       ) AND EXISTS (
         SELECT 1 FROM vacancy_semantic s WHERE s.title_key = p.title_key
           AND ${notExcludedVacancyIdSql('s.id')}
       ) ORDER BY p.priority DESC, p.title_key LIMIT ?`,
      )
      .all(limit) as { title_key: string; sample_title: string }[];
    const insert = this.database.prepare(
      'INSERT OR IGNORE INTO title_parse_model_queue (title_key, eligible, failures, frozen) VALUES (?, ?, 0, 0)',
    );
    for (const row of rows) insert.run(row.title_key, modelEligible(row.sample_title) ? 1 : 0);
  }

  private nextBatch(): TitleModelInput[] {
    return this.database
      .prepare(
        `SELECT p.title_key AS titleKey, p.sample_title AS sampleTitle
       FROM title_parse p INDEXED BY title_parse_queue
       JOIN title_parse_model_queue q ON q.title_key = p.title_key
       WHERE p.parsed_by = 'rules' AND q.eligible = 1 AND q.frozen = 0
       ORDER BY p.priority DESC, p.title_key LIMIT 40`,
      )
      .all() as unknown as TitleModelInput[];
  }

  /** Сбой вызова или пустой ответ на весь батч — не отказ модели: счётчики названий не трогаем. */
  private async tryParse(
    items: readonly TitleModelInput[],
  ): Promise<{ ok: true; answer: TitleParseAnswer } | { ok: false }> {
    try {
      const answer = await this.parser.parse(items);
      if (answer.results.length > 0) return { ok: true, answer };
      this.failCall(items, new Error('empty or invalid model answer for the whole batch'));
    } catch (error) {
      this.failCall(items, error);
    }
    return { ok: false };
  }

  private failCall(items: readonly TitleModelInput[], error: unknown): void {
    const reason = describeFailure(error);
    this.consecutiveFailures += 1;
    const delay = Math.min(15 * 60_000, 60_000 * 2 ** (this.consecutiveFailures - 1));
    this.pausedUntil = this.now() + delay;
    this.log?.warn({ reason, items: items.length, retryInMs: delay }, 'title-model-call-failed');
    const mark = this.database.prepare(
      'UPDATE title_parse_model_queue SET last_failure = ? WHERE title_key = ?',
    );
    for (const item of items) mark.run(`call: ${reason}`, item.titleKey);
  }

  private apply(items: readonly TitleModelInput[], answer: TitleParseAnswer) {
    const byKey = new Map(answer.results.map((result) => [result.titleKey, result]));
    const update = this.database.prepare(
      `UPDATE title_parse SET functions = ?, level_rank = ?, role_label = ?, parsed_by = 'model',
       model = ?, taxonomy_version = ?, parsed_at = ? WHERE title_key = ? AND parsed_by = 'rules'`,
    );
    const accept = this.database.prepare('DELETE FROM title_parse_model_queue WHERE title_key = ?');
    const refuse = this.database.prepare(
      `UPDATE title_parse_model_queue SET failures = failures + 1,
       frozen = CASE WHEN failures + 1 >= 3 THEN 1 ELSE 0 END,
       last_failure = 'refused: missing from the model answer' WHERE title_key = ?`,
    );
    let parsed = 0;
    let refused = 0;
    let frozen = 0;
    this.database.exec('BEGIN');
    try {
      for (const item of items) {
        const result = byKey.get(item.titleKey);
        if (result) {
          update.run(
            JSON.stringify(result.functions),
            result.levelRank,
            roleLabel(result.roleId),
            answer.model,
            TAXONOMY_VERSION,
            this.now(),
            item.titleKey,
          );
          this.rewriteSemantic(result);
          accept.run(item.titleKey);
          parsed += 1;
        } else {
          refuse.run(item.titleKey);
          const state = this.database
            .prepare('SELECT frozen FROM title_parse_model_queue WHERE title_key = ?')
            .get(item.titleKey) as { frozen: number };
          refused += 1;
          frozen += state.frozen;
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { parsed, refused, frozen };
  }

  /** Вакансии названия переписываются сразу: иначе они выпадают из подбора до следующего прохода разметки. */
  private rewriteSemantic(result: TitleModelResult): void {
    const rows = this.database
      .prepare(
        'SELECT DISTINCT id, published_ms, is_remote FROM vacancy_semantic WHERE title_key = ?',
      )
      .all(result.titleKey) as { id: string; published_ms: number; is_remote: number }[];
    this.database.prepare('DELETE FROM vacancy_semantic WHERE title_key = ?').run(result.titleKey);
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const pairs = rows.flatMap((row) => result.functions.map((code) => ({ row, code })));
    for (const { row, code } of pairs) {
      insert.run(row.id, code, result.levelRank, result.titleKey, row.published_ms, row.is_remote);
    }
  }

  private dailyState(): { day: string; calls: number } {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    this.database
      .prepare(
        'INSERT OR IGNORE INTO title_parse_model_daily (utc_day, calls, cap_logged) VALUES (?, 0, 0)',
      )
      .run(day);
    const row = this.database
      .prepare('SELECT calls FROM title_parse_model_daily WHERE utc_day = ?')
      .get(day) as { calls: number };
    return { day, calls: row.calls };
  }

  private addCalls(day: string, calls: number): void {
    this.database
      .prepare('UPDATE title_parse_model_daily SET calls = calls + ? WHERE utc_day = ?')
      .run(calls, day);
  }

  private markCapLogged(day: string): boolean {
    return (
      Number(
        this.database
          .prepare(
            'UPDATE title_parse_model_daily SET cap_logged = 1 WHERE utc_day = ? AND cap_logged = 0',
          )
          .run(day).changes,
      ) === 1
    );
  }
}

function uncertain(parsed: { functions: readonly FunctionCode[]; roleId?: string }): boolean {
  return parsed.functions.includes('other') || parsed.functions.length === 2 || !parsed.roleId;
}

/** B646-2: название, которое словарь freehire подтвердил как не-ИТ, модели не отдаём. */
function modelEligible(sampleTitle: string): boolean {
  return uncertain(rulesParse(sampleTitle)) && !isConfirmedNonItTitle(sampleTitle);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function roleLabel(roleId: string | undefined): string | null {
  return roleId ? (ontology.rolesById.get(roleId)?.titleEn ?? null) : null;
}
