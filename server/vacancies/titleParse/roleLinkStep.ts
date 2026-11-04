import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ontology } from '../../../shared/roleOntology';
import { MIGRATION_35 } from '../../data/sqliteSchema';
import type { BulkLlmClient } from '../../providers/bulkLlmClient';
import { rulesParse } from './rulesParse';
import { describeFailure } from './titleFreeze';

/**
 * Связь названия с ролью словаря (владелец 04.11): правила, затем модель на неизвестных с закрытым
 * списком ролей функций названия. Подбор таблицу `vacancy_role` пока не читает. Это малая партия:
 * точность смотрят глазами до массового прохода, поэтому потолок названий на модели задан в коде.
 */
export const ROLE_LINK_MODEL_TITLES = 200;
const BATCH = 40;
const MAX_CALLS_PER_PROCESS = 12;
const CANDIDATES = 600;
const ROLE_LINK_TASK = 'role-link';
const ROLE_LINK_MAX_TOKENS = 4_096;

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
  readonly linked: number;
  readonly noRole: number;
  /** Ответ не из закрытого списка: остаётся без роли, сам ответ хранится для разбора. */
  readonly outsideList: number;
  readonly failed: boolean;
}

const EMPTY_REPORT: RoleLinkReport = { rules: 0, linked: 0, noRole: 0, outsideList: 0, failed: false };

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

export class RoleLinkStep {
  private calls = 0;

  constructor(
    private readonly database: DatabaseSync,
    private readonly client: Pick<BulkLlmClient, 'complete'>,
    private readonly log?: { warn(fields: Record<string, unknown>, message: string): void },
    private readonly now: () => number = Date.now,
  ) {
    this.database.exec(MIGRATION_35);
  }

  private modelTitlesDone(): number {
    const row = this.database
      .prepare(`SELECT count(*) AS n FROM vacancy_role WHERE source = 'model'`)
      .get() as { n: number };
    return row.n;
  }

  /** Частые названия руководителей без связи: на них виден выигрыш подбора. */
  private candidates(): Candidate[] {
    return this.database
      .prepare(
        `SELECT p.title_key, p.sample_title, p.functions
         FROM (SELECT title_key, count(*) AS n FROM vacancy_semantic
               WHERE level_rank >= 2 GROUP BY title_key) s
         JOIN title_parse p ON p.title_key = s.title_key
         LEFT JOIN vacancy_role r ON r.title_key = s.title_key
         WHERE r.title_key IS NULL
         ORDER BY s.n DESC, s.title_key
         LIMIT ?`,
      )
      .all(CANDIDATES) as unknown as Candidate[];
  }

  private write(key: string, roleId: string | null, source: string, model: string | null, raw: string | null) {
    this.database
      .prepare(
        `INSERT OR REPLACE INTO vacancy_role (title_key, role_id, source, model, raw_role, created_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(key, roleId, source, model, raw, this.now());
  }

  private linkByRules(candidates: readonly Candidate[]): Candidate[] {
    return candidates.filter((candidate) => {
      const roleId = rulesParse(candidate.sample_title).roleId;
      if (roleId) this.write(candidate.title_key, roleId, 'rules', null, null);
      return !roleId;
    });
  }

  private async askModel(batch: readonly Candidate[]): Promise<Omit<RoleLinkReport, 'rules' | 'failed'>> {
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

  async run(): Promise<RoleLinkReport> {
    const left = ROLE_LINK_MODEL_TITLES - this.modelTitlesDone();
    if (left <= 0 || this.calls >= MAX_CALLS_PER_PROCESS) return EMPTY_REPORT;
    const candidates = this.candidates();
    const unknown = this.linkByRules(candidates);
    const rules = candidates.length - unknown.length;
    const batch = unknown.slice(0, Math.min(BATCH, left));
    if (batch.length === 0) return { ...EMPTY_REPORT, rules };
    this.calls += 1;
    try {
      return { ...EMPTY_REPORT, rules, ...(await this.askModel(batch)) };
    } catch (error) {
      this.log?.warn({ reason: describeFailure(error) }, 'role-link-call-failed');
      return { ...EMPTY_REPORT, rules, failed: true };
    }
  }
}
