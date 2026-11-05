import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ontology } from '../../../shared/roleOntology';
import { MIGRATION_35 } from '../../data/sqliteSchema';
import type { BulkLlmClient } from '../../providers/bulkLlmClient';
import { hasNoRoleToLink } from './roleLinkTitles';
import { rulesParse } from './rulesParse';
import { describeFailure } from './titleFreeze';

/**
 * Связь названия с ролью словаря (владелец 04.11): правила, затем модель на неизвестных с закрытым
 * списком ролей функций названия. Подбор таблицу `vacancy_role` пока не читает.
 *
 * Стадии идут по очереди, переключает их правка кода: `sample` — потолок названий, редкие из хвоста,
 * точность смотрят глазами; `pass` — все ключи руководителей, частые первыми, под потолком расхода.
 */
export type RoleLinkStage = 'sample' | 'pass';
export const ROLE_LINK_STAGE: RoleLinkStage = 'sample';
export const ROLE_LINK_MODEL_TITLES = 400;
export const ROLE_LINK_SPEND_CAP_USD = 10;
const TAIL_MAX_VACANCIES = 2;
const BATCH = 40;
const SAMPLE_CALLS_PER_PROCESS = 12;
/** Чтение очереди занимает секунды на проде: одно на много пачек, а не на каждый такт. */
const SAMPLE_QUEUE = 600;
const PASS_QUEUE = 3_000;
/** Фон не вытесняет вызовы, где ждёт кандидат: пачка не чаще раза в 2 минуты. */
const MIN_GAP_MS = 2 * 60_000;
/** Отказы подряд удваивают паузу: лежащий Vertex этот шаг не долбит. */
const REFUSAL_PAUSE_MS = 2 * 60_000;
const REFUSAL_PAUSE_MAX_MS = 30 * 60_000;
const ROLE_LINK_TASK = 'role-link';
const ROLE_LINK_MAX_TOKENS = 4_096;
const SOURCE_NO_FUNCTION = 'no-function';

const ROLE_LINK_PROMPT = `
Сопоставь каждое название вакансии с одной ролью из списка roles. Верни JSON-объект {"items": [...]}
с записями {"titleKey": "...", "roleId": "..."} ровно по одной на каждое название.
roleId бери только дословно из списка. Если подходящей роли нет, верни "roleId": null: не выбирай похожую.
Уровень важен: руководитель отдела и директор компании — разные роли. Не меняй titleKey, без пояснений.
`;

const answerSchema = z.object({ titleKey: z.string().min(1), roleId: z.string().nullable() });

interface Candidate {
  readonly title_key: string;
  readonly sample_title: string;
  readonly functions: string;
}

export interface RoleLinkReport {
  readonly rules: number;
  /** Без функции в названии или без своей роли: модель их не получает. */
  readonly noFunction: number;
  readonly linked: number;
  readonly noRole: number;
  /** Ответ не из закрытого списка: остаётся без роли, сам ответ хранится для разбора. */
  readonly outsideList: number;
  readonly failed: boolean;
}

const EMPTY_REPORT: RoleLinkReport = {
  rules: 0,
  noFunction: 0,
  linked: 0,
  noRole: 0,
  outsideList: 0,
  failed: false,
};

function functionsOf(candidate: Candidate): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(candidate.functions);
    return Array.isArray(parsed) ? parsed.filter((code) => typeof code === 'string') : [];
  } catch {
    return [];
  }
}

function rolesFor(batch: readonly Candidate[]) {
  const codes = new Set(batch.flatMap(functionsOf));
  return [...ontology.rolesById.values()].filter((role) => codes.has(role.function));
}

function decodeAnswers(content: string, keys: ReadonlySet<string>) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    return [];
  }
  const list = (decoded as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return [];
  return list.flatMap((value) => {
    const parsed = answerSchema.safeParse(value);
    return parsed.success && keys.has(parsed.data.titleKey) ? [parsed.data] : [];
  });
}

/** Ответ не с Gemini (партия 04.11: DeepSeek на 40 из 40 сказал «нет роли») спрашивается заново. */
const STALE = `(r.source = 'model' AND r.role_id IS NULL AND r.model NOT LIKE 'gemini%')`;

export class RoleLinkStep {
  private calls = 0;
  private refusalsInRow = 0;
  private nextCallAt = 0;
  private prepared = false;
  private queue: readonly Candidate[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly client: Pick<BulkLlmClient, 'complete'>,
    private readonly log?: { warn(fields: Record<string, unknown>, message: string): void },
    private readonly now: () => number = Date.now,
    private readonly stage: RoleLinkStage = ROLE_LINK_STAGE,
  ) {
    this.database.exec(MIGRATION_35);
  }

  private modelTitlesDone(): number {
    const row = this.database
      .prepare(
        `SELECT count(*) AS n FROM vacancy_role WHERE source = 'model' AND model LIKE 'gemini%'`,
      )
      .get() as { n: number };
    return row.n;
  }

  private spentUsd(): number {
    const ledger = this.database
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bulk_llm_spend'`)
      .get();
    if (!ledger) return 0;
    const row = this.database
      .prepare(`SELECT coalesce(sum(cost), 0) AS usd FROM bulk_llm_spend WHERE task = ?`)
      .get(ROLE_LINK_TASK) as { usd: number };
    return row.usd;
  }

  /** Сколько названий ещё можно отдать модели на этой стадии. */
  private modelRoom(): number {
    if (this.stage === 'pass') return this.spentUsd() < ROLE_LINK_SPEND_CAP_USD ? BATCH : 0;
    if (this.calls >= SAMPLE_CALLS_PER_PROCESS) return 0;
    return Math.min(BATCH, ROLE_LINK_MODEL_TITLES - this.modelTitlesDone());
  }

  /** Названия руководителей без связи; ответы не с Gemini первыми. */
  private readQueue(): Candidate[] {
    const sample = this.stage === 'sample';
    return this.database
      .prepare(
        `SELECT p.title_key, p.sample_title, p.functions
         FROM (SELECT title_key, count(*) AS n FROM vacancy_semantic
               WHERE level_rank >= 2 GROUP BY title_key) s
         JOIN title_parse p ON p.title_key = s.title_key
         LEFT JOIN vacancy_role r ON r.title_key = s.title_key
         WHERE ${
           sample
             ? `${STALE} OR (r.title_key IS NULL AND s.n <= ${TAIL_MAX_VACANCIES})`
             : `${STALE} OR r.title_key IS NULL`
         }
         ORDER BY ${STALE} DESC, ${sample ? 'random()' : 's.n DESC, s.title_key'}
         LIMIT ?`,
      )
      .all(sample ? SAMPLE_QUEUE : PASS_QUEUE) as unknown as Candidate[];
  }

  private write(
    key: string,
    roleId: string | null,
    source: string,
    model: string | null,
    raw: string | null,
  ): void {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO vacancy_role (title_key, role_id, source, model, raw_role, created_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(key, roleId, source, model, raw, this.now());
  }

  /**
   * Разовая уборка партии 04.11: главные бухгалтеры ушли в рядового бухгалтера, пока своей роли не
   * было; названия без функции получили роль наугад.
   */
  private cleanUp(): void {
    const accountants = this.database
      .prepare(
        `SELECT title_key FROM vacancy_role WHERE role_id = 'finance.accountant.ic' AND title_key LIKE 'главный бухгалтер%'`,
      )
      .all() as unknown as { title_key: string }[];
    for (const { title_key: key } of accountants) {
      this.write(key, rulesParse(key).roleId ?? null, 'rules', null, null);
    }
    const linked = this.database
      .prepare(`SELECT title_key FROM vacancy_role WHERE source = 'model'`)
      .all() as unknown as { title_key: string }[];
    for (const { title_key: key } of linked) {
      if (hasNoRoleToLink(key)) this.write(key, null, SOURCE_NO_FUNCTION, null, null);
    }
  }

  /** Правила и названия без функции не тратят вызов: модель получает только остаток. */
  private settleWithoutModel(candidates: readonly Candidate[]): {
    readonly unknown: Candidate[];
    readonly rules: number;
    readonly noFunction: number;
  } {
    const unknown: Candidate[] = [];
    let rules = 0;
    let noFunction = 0;
    for (const candidate of candidates) {
      const roleId = rulesParse(candidate.sample_title).roleId;
      if (roleId) {
        this.write(candidate.title_key, roleId, 'rules', null, null);
        rules += 1;
      } else if (hasNoRoleToLink(candidate.title_key)) {
        this.write(candidate.title_key, null, SOURCE_NO_FUNCTION, null, null);
        noFunction += 1;
      } else {
        unknown.push(candidate);
      }
    }
    return { unknown, rules, noFunction };
  }

  private async askModel(
    batch: readonly Candidate[],
  ): Promise<Pick<RoleLinkReport, 'linked' | 'noRole' | 'outsideList'>> {
    const roles = rolesFor(batch);
    const allowed = new Set(roles.map((role) => role.id));
    const keys = new Set(batch.map((candidate) => candidate.title_key));
    const result = await this.client.complete({
      runId: `${ROLE_LINK_TASK}:${new Date(this.now()).toISOString().slice(0, 10)}`,
      task: ROLE_LINK_TASK,
      dataClass: 'public',
      prefix: ROLE_LINK_PROMPT,
      input: JSON.stringify({
        roles: roles.map((role) => ({ id: role.id, en: role.titleEn, ru: role.titleRu })),
        titles: batch.map((item) => ({ titleKey: item.title_key, title: item.sample_title })),
      }),
      maxTokens: ROLE_LINK_MAX_TOKENS,
      onlyVertex: true,
      accept: (content) => decodeAnswers(content, keys).length > 0,
    });
    const counts = { linked: 0, noRole: 0, outsideList: 0 };
    for (const { titleKey, roleId } of decodeAnswers(result.content, keys)) {
      const known = roleId !== null && allowed.has(roleId);
      this.write(titleKey, known ? roleId : null, 'model', result.model, roleId);
      if (known) counts.linked += 1;
      else if (roleId === null) counts.noRole += 1;
      else counts.outsideList += 1;
    }
    return counts;
  }

  private refillQueue(): Pick<RoleLinkReport, 'rules' | 'noFunction'> {
    if (this.queue.length > 0) return { rules: 0, noFunction: 0 };
    const { unknown, rules, noFunction } = this.settleWithoutModel(this.readQueue());
    this.queue = unknown;
    return { rules, noFunction };
  }

  async run(): Promise<RoleLinkReport> {
    if (this.now() < this.nextCallAt || this.modelRoom() <= 0) return EMPTY_REPORT;
    if (!this.prepared) {
      this.cleanUp();
      this.prepared = true;
    }
    const settled = this.refillQueue();
    const room = this.modelRoom();
    const batch = this.queue.slice(0, room);
    if (batch.length === 0) return { ...EMPTY_REPORT, ...settled };
    try {
      const answered = await this.askModel(batch);
      // Предел считает ответы: отказы сдерживает пауза.
      this.calls += 1;
      this.refusalsInRow = 0;
      this.nextCallAt = this.now() + MIN_GAP_MS;
      // Название без ответа в пачке вернётся при следующем чтении очереди.
      this.queue = this.queue.slice(batch.length);
      return { ...EMPTY_REPORT, ...settled, ...answered };
    } catch (error) {
      // Нет ответа Gemini: строк нет, ключи остаются в очереди.
      const pause = Math.min(REFUSAL_PAUSE_MS * 2 ** this.refusalsInRow, REFUSAL_PAUSE_MAX_MS);
      this.refusalsInRow += 1;
      this.nextCallAt = this.now() + pause;
      this.log?.warn(
        { reason: describeFailure(error), refusalsInRow: this.refusalsInRow, pauseMs: pause },
        'role-link-call-failed',
      );
      return { ...EMPTY_REPORT, ...settled, failed: true };
    }
  }
}
