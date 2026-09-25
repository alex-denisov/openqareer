import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ROLE_TAXONOMY, TAXONOMY_VERSION, type FunctionCode } from '../../../shared/roleTaxonomy';
import { ontology } from '../../../shared/roleOntology';
import { MIGRATION_35 } from '../../data/sqliteSchema';
import {
  retryOn429,
  VertexTokenProvider,
  vertexPublisherBaseUrl,
  type VertexConfig,
} from '../../providers/vertexAi';
import { rulesParse } from './rulesParse';

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

export interface ModelTitleParser {
  readonly model: string;
  parse(items: readonly TitleModelInput[]): Promise<readonly TitleModelResult[]>;
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

const RESPONSE_SCHEMA = {
  type: 'array',
  maxItems: 40,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['titleKey', 'functions', 'levelRank'],
    properties: {
      titleKey: { type: 'string' },
      // Vertex отвечает 400 на `enum` внутри элементов массива — коды перечислены в промпте, проверяет zod.
      functions: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
      levelRank: { type: ['integer', 'null'], minimum: 0, maximum: 4 },
      roleId: { type: 'string' },
    },
  },
} as const;

const SYSTEM_PROMPT = `
Разбери каждое название вакансии. Верни ровно по одной записи на titleKey.
functions содержит 1–2 кода только из списка: ${FUNCTION_CODES.join(', ')}.
levelRank — уровень должности по шкале: 0 — специалист любого грейда (junior…principal, senior, associate, analyst, engineer, manager без подчинённых руководителей); 1 — lead, team lead, руководитель группы; 2 — head of, director, руководитель направления/отдела; 3 — VP, senior director, вице-президент; 4 — C-level (CEO, CTO, CIO, COO, CFO, генеральный/технический/финансовый директор). null — если уровень не определить.
Chief of Staff — 2, не 4.
roleId указывай только при уверенном соответствии роли из онтологии.
Не добавляй пояснений и не меняй titleKey.
`;

interface ParserDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly token?: () => Promise<string>;
}

export class VertexModelTitleParser implements ModelTitleParser {
  readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly token: () => Promise<string>;

  constructor(
    private readonly config: VertexConfig,
    dependencies: ParserDependencies = {},
  ) {
    this.model = config.model;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    const provider = new VertexTokenProvider(config, this.fetchImpl);
    this.token = dependencies.token ?? (() => provider.token());
  }

  async parse(items: readonly TitleModelInput[]): Promise<readonly TitleModelResult[]> {
    if (items.length === 0) return [];
    if (items.length > 40) throw new Error('title model batch exceeds 40 items');
    const token = await this.token();
    const response = await retryOn429(() => this.send(items, token), 2);
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 400);
      throw new Error(`title model failed with status ${response.status}: ${detail}`);
    }
    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
    if (!text) return [];
    const allowedKeys = new Set(items.map((item) => item.titleKey));
    const decoded = safeJson(text);
    if (!Array.isArray(decoded)) return [];
    return decoded.flatMap((value) => {
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

  private send(items: readonly TitleModelInput[], token: string): Promise<Response> {
    const url = `${vertexPublisherBaseUrl(this.config)}/models/${encodeURIComponent(this.model)}:generateContent`;
    return this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(items) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
      signal: AbortSignal.timeout(25_000),
    });
  }
}

export interface TitleModelStepReport {
  readonly batches: number;
  readonly parsed: number;
  readonly refused: number;
  readonly frozen: number;
  readonly callsToday: number;
  readonly dailyCapReached: boolean;
  readonly ms: number;
}

interface TitleModelStepOptions {
  readonly dailyCalls?: number;
  readonly maxBatches?: number;
  readonly now?: () => number;
}

export class TitleModelStep {
  private readonly dailyCalls: number;
  private readonly maxBatches: number;
  private readonly now: () => number;

  constructor(
    private readonly database: DatabaseSync,
    private readonly parser: ModelTitleParser,
    options: TitleModelStepOptions = {},
  ) {
    this.dailyCalls = options.dailyCalls ?? 2_000;
    this.maxBatches = options.maxBatches ?? 3;
    this.now = options.now ?? Date.now;
    this.database.exec(MIGRATION_35);
  }

  async run(): Promise<TitleModelStepReport> {
    const startedAt = this.now();
    this.seedQueue(500);
    const daily = this.dailyState();
    let batches = 0;
    let parsed = 0;
    let refused = 0;
    let frozen = 0;
    while (batches < this.maxBatches && daily.calls + batches < this.dailyCalls) {
      const items = this.nextBatch();
      if (items.length === 0) break;
      const results = await this.tryParse(items);
      const applied = this.apply(items, results);
      batches += 1;
      parsed += applied.parsed;
      refused += applied.refused;
      frozen += applied.frozen;
    }
    if (batches > 0) this.addCalls(daily.day, batches);
    const callsToday = daily.calls + batches;
    const atCap = callsToday >= this.dailyCalls;
    const dailyCapReached = atCap && this.markCapLogged(daily.day);
    return {
      batches,
      parsed,
      refused,
      frozen,
      callsToday,
      dailyCapReached,
      ms: this.now() - startedAt,
    };
  }

  private seedQueue(limit: number): void {
    const rows = this.database
      .prepare(
        `SELECT p.title_key, p.sample_title FROM title_parse p INDEXED BY title_parse_queue
       WHERE p.parsed_by = 'rules' AND NOT EXISTS (
         SELECT 1 FROM title_parse_model_queue q WHERE q.title_key = p.title_key
       ) ORDER BY p.priority DESC, p.title_key LIMIT ?`,
      )
      .all(limit) as { title_key: string; sample_title: string }[];
    const insert = this.database.prepare(
      'INSERT OR IGNORE INTO title_parse_model_queue (title_key, eligible, failures, frozen) VALUES (?, ?, 0, 0)',
    );
    for (const row of rows)
      insert.run(row.title_key, uncertain(rulesParse(row.sample_title)) ? 1 : 0);
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

  private async tryParse(items: readonly TitleModelInput[]): Promise<readonly TitleModelResult[]> {
    try {
      return await this.parser.parse(items);
    } catch {
      return [];
    }
  }

  private apply(items: readonly TitleModelInput[], results: readonly TitleModelResult[]) {
    const byKey = new Map(results.map((result) => [result.titleKey, result]));
    const update = this.database.prepare(
      `UPDATE title_parse SET functions = ?, level_rank = ?, role_label = ?, parsed_by = 'model',
       model = ?, taxonomy_version = ?, parsed_at = ? WHERE title_key = ? AND parsed_by = 'rules'`,
    );
    const accept = this.database.prepare('DELETE FROM title_parse_model_queue WHERE title_key = ?');
    const refuse = this.database.prepare(
      `UPDATE title_parse_model_queue SET failures = failures + 1,
       frozen = CASE WHEN failures + 1 >= 3 THEN 1 ELSE 0 END WHERE title_key = ?`,
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
            this.parser.model,
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
