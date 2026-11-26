import type { DatabaseSync } from 'node:sqlite';
import { TAXONOMY_VERSION, type FunctionCode } from '../../../shared/roleTaxonomy';
import { MIGRATION_35 } from '../../data/sqliteSchema';
import { normalizeTitleKey } from './normalizeTitleKey';
import { LEVEL_RANK } from '../levelMatcher';
import { isSeniorManagerLead } from './rulesLevel';
import { gradeRangeOfTitle } from './gradeRange';
import { isChiefInformationTitle } from './chiefInformationTitle';
import { exactOntologyTitleKeys, rulesParse } from './rulesParse';
import { freehireItFunction } from './freehireClassify/classify';

/**
 * Фоновое наполнение смыслового индекса правилами (B267 S2, план §4 фаза 1).
 *
 * Живёт в процессе обслуживания на его соединении: HTTP-процесс этот код не
 * вызывает. Обход идёт по первичному ключу `vacancy_pool_index` курсором в
 * памяти — без LIKE и без полного чтения пула; одна порция — одна короткая
 * транзакция. Название, которое правила не узнали, получает код `other`:
 * иначе строка без семантики выбиралась бы на каждом проходе заново.
 */

export interface SemanticBackfillReport {
  readonly scanned: number;
  /** Индексные строки, пройденные курсором, включая размеченные и expired. */
  readonly poolRowsScanned: number;
  readonly backfilled: number;
  readonly newKeys: number;
  readonly pruned: number;
  readonly passFinished: boolean;
  readonly relabeled: number;
  /** Модельные разборы, исправленные точным вариантом онтологии (раз за процесс). */
  readonly ontologyCorrected: number;
}

interface PoolRow {
  id: string;
  published_ms: number | null;
  is_remote: number | null;
  title: string | null;
}

interface ParsedTitle {
  readonly functions: readonly FunctionCode[];
  readonly levelRank: number | null;
  readonly roleId?: string;
}

const PRUNE_CHUNK = 5_000;
/** B641 10.11: whole-table prune at pass end held the loop ~10 s; one rowid window per step. */
// B649-4 13.11: на проде окно 20 000 держало шаг ~0,9 с, весь шаг 1,1 с; окна по 5 000.
const PRUNE_WINDOW = 5_000;
const MISSING_WINDOW = 5_000;
const CORRECTION_WINDOW = 5_000;
const CORRECTION_CHUNK = 500;
const CORRECTION_BUDGET_MS = 300;
const SLOW_STEP_MS = 1_000;
const RELABEL_WINDOW = 5_000;

interface Correction {
  key: string;
  functions: string;
  levelRank: number | null;
}

interface OneRoleRow {
  title_key: string;
  sample_title: string;
  functions: string;
  level_rank: number | null;
  parsed_by: string;
}
/** Названий на шаг для грейдов: только правила, модель не вызывается. */
const GRADE_CHUNK = 500;
/** Выше этой ступени название уже различает `level_rank`. */
const GRADE_MAX_LEVEL_RANK = 1;
/** Названий на переразбор за шаг: удаление строк индекса идёт по `title_key`. */
const RELABEL_CHUNK = 200;

export class SemanticBackfill {
  private readonly database: DatabaseSync;
  private cursor = '';
  private pruneCursor = 0;
  private prunedSincePass = 0;
  private missingCursor = '';
  private missingDone = false;
  private gradeCursor = '';
  /** Устаревших разборов не осталось — до рестарта таблицу больше не обходим. */
  private relabelDone = false;
  private relabelCursor = 0;
  private ontologyCorrectionDone = false;
  private correctionPhase: 'exact' | 'scan' = 'exact';
  private correctionOffset = 0;
  private readonly exactCorrected = new Set<string>();

  constructor(
    database: DatabaseSync,
    private readonly onGradeError?: (reason: string) => void,
    private readonly onSlowStep?: (stages: Readonly<Record<string, number>>) => void,
  ) {
    this.database = database;
    this.database.exec(MIGRATION_35);
  }

  /**
   * Одна порция: окно из следующих `chunk` ключей индекса после курсора.
   * Цена шага — O(chunk) и в первом проходе, и когда почти всё уже размечено:
   * LIMIT по совпадениям на размеченном пуле обходил бы весь индекс за шаг.
   */
  step(chunk: number): SemanticBackfillReport {
    // B641 10.11: первый шаг после старта держал цикл 7,6 с; стадии медленного
    // шага уходят в журнал, чтобы найти виновника на проде.
    const stages: Record<string, number> = {};
    const timed = <T>(name: string, run: () => T): T => {
      const startedAt = Date.now();
      try {
        return run();
      } finally {
        stages[name] = Date.now() - startedAt;
      }
    };
    const ontologyCorrected = timed('corrections', () => this.correctByExactOntology());
    const relabeled = timed('relabel', () => this.relabelStale(RELABEL_CHUNK));
    const caughtUp = timed('catchUp', () => this.catchUpMissing(chunk));
    const windowEnd = timed('windowEnd', () => this.windowEnd(chunk));
    const rows = timed('readWindow', () => this.readWindow(windowEnd));
    const written = timed('writeChunk', () => this.writeChunk(rows));
    const backfilled = written.backfilled + caughtUp.backfilled;
    const newKeys = written.newKeys + caughtUp.newKeys;
    const poolRowsScanned =
      windowEnd === null ? timed('countRemaining', () => this.countRemainingRows()) : chunk;
    const passFinished = windowEnd === null;
    this.cursor = windowEnd ?? '';
    this.prunedSincePass += timed('prune', () => this.pruneOrphans());
    const pruned = passFinished ? this.prunedSincePass : 0;
    if (passFinished) this.prunedSincePass = 0;
    timed('grade', () => this.gradeStep());
    const totalMs = Object.values(stages).reduce((sum, ms) => sum + ms, 0);
    if (totalMs >= SLOW_STEP_MS) this.onSlowStep?.({ ...stages, totalMs });
    return {
      scanned: rows.length + caughtUp.backfilled,
      poolRowsScanned,
      backfilled,
      newKeys,
      pruned,
      passFinished,
      relabeled,
      ontologyCorrected,
    };
  }

  /**
   * Точный вариант онтологии главнее модели: модель ставила рядовому
   * руководителю группы уровень Head, и VP видел его как «совпадает».
   * Читаются только ключи онтологии по первичному ключу (несколько тысяч),
   * переписываются лишь расходящиеся; строки индекса по ним пересоберёт
   * ближайший проход наполнения. Один раз за процесс.
   */
  private correctByExactOntology(): number {
    // B641 10.11: все три правки разом держали первый шаг 5,4 с на проде
    // (7 100 строк через rulesParse). Теперь по CORRECTION_CHUNK за шаг, в
    // прежнем порядке: точные ключи онтологии главнее остальных правок.
    if (this.ontologyCorrectionDone) return 0;
    const startedAt = Date.now();
    let applied = 0;
    while (Date.now() - startedAt < CORRECTION_BUDGET_MS) {
      const batch = this.nextCorrectionBatch();
      if (batch === undefined) {
        this.ontologyCorrectionDone = true;
        break;
      }
      const corrections = batch.filter((correction) => !this.exactCorrected.has(correction.key));
      if (this.correctionPhase === 'exact') {
        for (const correction of corrections) this.exactCorrected.add(correction.key);
      }
      if (corrections.length > 0) this.applyCorrections(corrections);
      applied += corrections.length;
    }
    return applied;
  }

  /** Следующая порция правок; `undefined` — все три правки пройдены. */
  private nextCorrectionBatch(): Correction[] | undefined {
    if (this.correctionPhase === 'exact') {
      const keys = exactOntologyTitleKeys();
      if (this.correctionOffset < keys.length) {
        const slice = keys.slice(this.correctionOffset, this.correctionOffset + CORRECTION_CHUNK);
        this.correctionOffset += CORRECTION_CHUNK;
        return this.exactOntologyCorrections(slice);
      }
      this.correctionPhase = 'scan';
      this.correctionOffset = 0;
      return [];
    }
    // B641 10.11: два LIKE-запроса по всему title_parse на холодном кэше
    // держали шаг до 4 с. Окно CORRECTION_WINDOW строк по rowid за порцию;
    // в окне сначала «руководитель группы», потом CIO/поддержка — как раньше.
    const from = this.correctionOffset;
    const max = (
      this.database.prepare('SELECT max(rowid) AS m FROM title_parse').get() as { m: number | null }
    ).m;
    if (max === null || from >= max) return undefined;
    const to = from + CORRECTION_WINDOW;
    this.correctionOffset = to;
    return [
      ...this.seniorManagerCorrections(from, to),
      ...this.oneRoleCorrections(this.readOneRoleRows(from, to)),
    ];
  }

  /**
   * Владелец 04.11: CIO, ИТ-директор и IT Director — одна роль, служба поддержки — поддержка, отдел ИТ — не госслужба, Centum VP — не вице-президент. Версия словаря не
   * меняется: пересчитываются только эти названия. Модельный разбор поддержки не трогается, запись
   * идёт лишь при расхождении, поэтому повторный проход не пишет в базу.
   */
  private readOneRoleRows(from: number, to: number): OneRoleRow[] {
    return this.database
      .prepare(
        `SELECT title_key, sample_title, functions, level_rank, parsed_by FROM title_parse
         WHERE rowid > ? AND rowid <= ? AND ((parsed_by = 'rules' AND title_key LIKE '%поддержк%')
           OR (parsed_by = 'rules' AND functions IN ('[]', '["other"]') AND taxonomy_version >= ${TAXONOMY_VERSION})
           OR (parsed_by = 'rules' AND title_key LIKE '%centum vp%')
           OR (parsed_by = 'rules' AND functions LIKE '%public-service%'
             AND (title_key LIKE '% it%' OR title_key LIKE '% ит%'))
           OR ((title_key LIKE '%директор%' OR title_key LIKE '%департамент%' OR title_key LIKE '%director%'
               OR title_key LIKE '%chief information%')
             AND (title_key LIKE '%it%' OR title_key LIKE '%ит%'
               OR title_key LIKE '%информац%' OR title_key LIKE '%information%')))`,
      )
      .all(from, to) as unknown as OneRoleRow[];
  }

  private oneRoleCorrections(rows: readonly OneRoleRow[]): Correction[] {
    return rows.flatMap((row) => {
      const chief = isChiefInformationTitle(row.sample_title);
      const service = row.parsed_by === 'rules' && !row.functions.includes('"support"');
      const product = row.parsed_by === 'rules' && row.title_key.includes('centum vp');
      // B646-2: пустой или `other` разбор правил, который словарь freehire читает как ИТ.
      // Сначала дешёвый словарь (0,2 мс), полный разбор только на совпадении.
      const unfiledRow =
        row.parsed_by === 'rules' && (row.functions === '[]' || row.functions === '["other"]');
      const unfiled = unfiledRow && freehireItFunction(row.sample_title) !== null;
      if (unfiledRow && !unfiled && !chief && !product && !row.title_key.includes('поддержк'))
        return [];
      if (!chief && !service && !product && !unfiled) return [];
      const parsed = rulesParse(row.sample_title);
      const functions = JSON.stringify(parsed.functions);
      const same = functions === row.functions && parsed.levelRank === row.level_rank;
      const fixed =
        (unfiled && parsed.functions.some((code) => code !== 'other')) ||
        parsed.functions.includes('support') ||
        (row.functions.includes('public-service') && parsed.functions.includes('it-ops'));
      return (chief || fixed || product) && !same
        ? [{ key: row.title_key, functions, levelRank: parsed.levelRank }]
        : [];
    });
  }

  private exactOntologyCorrections(keys: readonly string[]): Correction[] {
    const read = this.database.prepare(
      `SELECT title_key, sample_title, functions, level_rank FROM title_parse
       WHERE title_key = ? AND parsed_by = 'model'`,
    );
    return keys.flatMap((key) => {
      const row = read.get(key) as
        | { title_key: string; sample_title: string; functions: string; level_rank: number | null }
        | undefined;
      if (!row) return [];
      const parsed = rulesParse(row.sample_title);
      if (!parsed.roleId) return [];
      const functions = JSON.stringify(parsed.functions);
      if (functions === row.functions && parsed.levelRank === row.level_rank) return [];
      return [{ key: row.title_key, functions, levelRank: parsed.levelRank }];
    });
  }

  private applyCorrections(
    corrections: readonly { key: string; functions: string; levelRank: number | null }[],
  ): void {
    const update = this.database.prepare(
      `UPDATE title_parse SET functions = ?, level_rank = ?, parsed_by = 'rules', model = NULL,
         taxonomy_version = ?, parsed_at = ? WHERE title_key = ?`,
    );
    const drop = this.database.prepare('DELETE FROM vacancy_semantic WHERE title_key = ?');
    // Без строки очереди модель взяла бы название снова и вернула свой разбор.
    const keepFromModel = this.database.prepare(
      `INSERT OR REPLACE INTO title_parse_model_queue (title_key, eligible, failures, frozen)
       VALUES (?, 0, 0, 0)`,
    );
    const now = Date.now();
    this.database.exec('BEGIN');
    try {
      for (const correction of corrections) {
        update.run(
          correction.functions,
          correction.levelRank,
          TAXONOMY_VERSION,
          now,
          correction.key,
        );
        drop.run(correction.key);
        keepFromModel.run(correction.key);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * CPO 26.10: модель ставила «Senior Manager …», «Senior Engineering Manager»
   * и «Руководитель группы …» уровень Head (3 724 названия на проде). Разбор
   * правилами до 26.10 делал то же самое (1 219 «Руководитель группы»), а
   * версия словаря не менялась — поэтому переписываются оба вида разбора. Уровень становится lead, функции модели остаются. Один проход
   * по `title_parse` за процесс, вместе с исправлением по онтологии.
   */
  private seniorManagerCorrections(
    from: number,
    to: number,
  ): { key: string; functions: string; levelRank: number }[] {
    const rows = this.database
      .prepare(
        `SELECT title_key, sample_title, functions FROM title_parse
         WHERE rowid > ? AND rowid <= ? AND parsed_by IN ('model', 'rules') AND level_rank > ?
           AND (title_key LIKE '%senior manager%' OR title_key LIKE '%sr manager%'
             OR title_key LIKE '%sr. manager%' OR title_key LIKE '%senior % manager%'
             OR title_key LIKE '%руководитель группы%' OR title_key LIKE '%group lead%')`,
      )
      .all(from, to, LEVEL_RANK.lead) as {
      title_key: string;
      sample_title: string;
      functions: string;
    }[];
    return rows
      .filter((row) => isSeniorManagerLead(row.sample_title))
      .map((row) => ({ key: row.title_key, functions: row.functions, levelRank: LEVEL_RANK.lead }));
  }

  /**
   * Смена словаря (`TAXONOMY_VERSION`): разбор правилами старой версии
   * пересчитывается, строки индекса по этому названию удаляются, и ближайший
   * проход наполнения вставляет их заново уже с новым разбором. Модельный
   * разбор не трогается — он главнее правил.
   */
  private relabelStale(limit: number): number {
    if (this.relabelDone) return 0;
    // B641 10.11: без устаревших строк запрос обходил весь title_parse (6,2 с
    // на первом шаге после старта). Окно RELABEL_WINDOW строк по rowid за шаг.
    const from = this.relabelCursor;
    const stale = this.database
      .prepare(
        `SELECT title_key, sample_title FROM title_parse
         WHERE rowid > ? AND rowid <= ? AND parsed_by = 'rules' AND taxonomy_version < ?
         ORDER BY rowid LIMIT ?`,
      )
      .all(from, from + RELABEL_WINDOW, TAXONOMY_VERSION, limit) as {
      title_key: string;
      sample_title: string;
    }[];
    if (stale.length < limit) this.advanceRelabelCursor(from + RELABEL_WINDOW);
    if (stale.length === 0) return 0;
    const parsed = stale.map((row) => ({ ...row, parsed: rulesParseOrOther(row.sample_title) }));
    const update = this.database.prepare(
      `UPDATE title_parse SET functions = ?, level_rank = ?, taxonomy_version = ?, parsed_at = ?
       WHERE title_key = ? AND parsed_by = 'rules'`,
    );
    const drop = this.database.prepare('DELETE FROM vacancy_semantic WHERE title_key = ?');
    const now = Date.now();
    this.database.exec('BEGIN');
    try {
      for (const row of parsed) {
        update.run(
          JSON.stringify(row.parsed.functions),
          row.parsed.levelRank,
          TAXONOMY_VERSION,
          now,
          row.title_key,
        );
        drop.run(row.title_key);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return stale.length;
  }

  private advanceRelabelCursor(next: number): void {
    const max = (
      this.database.prepare('SELECT max(rowid) AS m FROM title_parse').get() as { m: number | null }
    ).m;
    if (max !== null && next < max) this.relabelCursor = next;
    else this.relabelDone = true;
  }

  /** Сбой грейдов уходит в журнал и не останавливает индексацию вакансий. */
  private gradeStep(): void {
    try {
      this.gradeTitles(GRADE_CHUNK);
    } catch (error) {
      this.onGradeError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Грейд по слову в названии. Хранятся только названия со словом: без него строка подбор не сужает.
   * Запись идёт лишь при изменении, поэтому повторный проход не пишет в базу.
   */
  private gradeTitles(limit: number): number {
    const rows = this.database
      .prepare(
        `SELECT p.title_key AS key, p.sample_title AS title, p.level_rank AS rank,
                g.grade_min AS min, g.grade_max AS max
         FROM title_parse p LEFT JOIN vacancy_grade g ON g.title_key = p.title_key
         WHERE p.title_key > ? ORDER BY p.title_key LIMIT ?`,
      )
      .all(this.gradeCursor, limit) as {
      key: string;
      title: string;
      rank: number | null;
      min: number | null;
      max: number | null;
    }[];
    this.gradeCursor = rows.length < limit ? '' : (rows.at(-1)?.key ?? '');
    const upsert = this.database.prepare(
      `INSERT INTO vacancy_grade (title_key, grade_min, grade_max) VALUES (?, ?, ?)
       ON CONFLICT(title_key) DO UPDATE SET grade_min = excluded.grade_min, grade_max = excluded.grade_max`,
    );
    const remove = this.database.prepare('DELETE FROM vacancy_grade WHERE title_key = ?');
    const changes = rows.flatMap((row) => {
      const range =
        row.rank === null || row.rank <= GRADE_MAX_LEVEL_RANK ? gradeRangeOfTitle(row.title) : null;
      const same = (range?.min ?? null) === row.min && (range?.max ?? null) === row.max;
      return same ? [] : [{ key: row.key, range }];
    });
    if (changes.length === 0) return 0;
    this.database.exec('BEGIN');
    try {
      for (const { key, range } of changes) {
        if (range) upsert.run(key, range.min, range.max);
        else remove.run(key);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return changes.length;
  }

  /** Сколько названий уже в кеше — для журнала в конце прохода. */
  countKeys(): number {
    return (this.database.prepare('SELECT count(*) AS n FROM title_parse').get() as { n: number })
      .n;
  }

  /**
   * Живые вакансии без строки индекса возвращаются сразу, а не по ходу прохода: проход начинается с
   * начала при каждом старте, и частые выкаты не давали ему дойти до строк, снятых правкой разбора
   * (04.11: 7 эталонных вакансий пропали из подбора). Список читается один раз за процесс, около 1 с.
   */
  private catchUpMissing(chunk: number): { backfilled: number; newKeys: number } {
    // B641 10.11: один запрос по всему индексу занимал 17,8 с на проде. Теперь
    // окно в MISSING_WINDOW строк индекса за шаг; проход один раз за процесс.
    if (this.missingDone) return { backfilled: 0, newKeys: 0 };
    const from = this.missingCursor;
    const end = this.database
      .prepare('SELECT id FROM vacancy_pool_index WHERE id > ? ORDER BY id LIMIT 1 OFFSET ?')
      .get(from, MISSING_WINDOW - 1) as { id: string } | undefined;
    const upperBound = end ? 'AND i.id <= ?' : '';
    const params = end ? [from, end.id, chunk] : [from, chunk];
    const rows = this.database
      .prepare(
        `SELECT i.id, i.published_ms, i.is_remote, json_extract(p.payload, '$.title') AS title
         FROM vacancy_pool_index i JOIN vacancy_pool p ON p.id = i.id
         WHERE i.id > ? ${upperBound} AND i.expired = 0
           AND NOT EXISTS (SELECT 1 FROM vacancy_semantic s WHERE s.id = i.id)
         ORDER BY i.id LIMIT ?`,
      )
      .all(...params) as unknown as PoolRow[];
    // Полная порция — в окне могут остаться строки: курсор встаёт на последнюю.
    if (rows.length === chunk) this.missingCursor = rows[rows.length - 1]!.id;
    else if (end) this.missingCursor = end.id;
    else this.missingDone = true;
    return this.writeChunk(rows);
  }

  /** Последний ключ окна; `null` — окно дошло до конца индекса. */
  private windowEnd(chunk: number): string | null {
    const row = this.database
      .prepare('SELECT id FROM vacancy_pool_index WHERE id > ? ORDER BY id LIMIT 1 OFFSET ?')
      .get(this.cursor, chunk - 1) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** При `windowEnd === null` на хвосте осталось меньше одного chunk. */
  private countRemainingRows(): number {
    return (
      this.database
        .prepare('SELECT count(*) AS n FROM vacancy_pool_index WHERE id > ?')
        .get(this.cursor) as { n: number }
    ).n;
  }

  private readWindow(windowEnd: string | null): PoolRow[] {
    // Два текста запроса, а не `? IS NULL OR id <= ?`: иначе планировщик не
    // берёт верхнюю границу в диапазон индекса и дочитывает его до конца.
    const upperBound = windowEnd === null ? '' : 'AND i.id <= ?';
    const params = windowEnd === null ? [this.cursor] : [this.cursor, windowEnd];
    return this.database
      .prepare(
        `SELECT i.id, i.published_ms, i.is_remote, json_extract(p.payload, '$.title') AS title
         FROM vacancy_pool_index i JOIN vacancy_pool p ON p.id = i.id
         WHERE i.id > ? ${upperBound} AND i.expired = 0
           AND NOT EXISTS (SELECT 1 FROM vacancy_semantic s WHERE s.id = i.id)
         ORDER BY i.id`,
      )
      .all(...params) as unknown as PoolRow[];
  }

  /**
   * Разбор (правила, чтение кеша) идёт до `BEGIN`: HTTP-процесс пишет в ту же
   * базу и ждёт блокировку синхронно, поэтому в транзакции остаются только
   * вставки — миллисекунды, а не сотни миллисекунд разбора.
   */
  private writeChunk(rows: readonly PoolRow[]): { backfilled: number; newKeys: number } {
    if (rows.length === 0) return { backfilled: 0, newKeys: 0 };
    const { resolved, newKeys } = this.resolveTitles(rows);
    const insertKey = this.database.prepare(
      `INSERT INTO title_parse
         (title_key, sample_title, functions, level_rank, role_label, parsed_by, model, taxonomy_version, priority, parsed_at)
       VALUES (?, ?, ?, ?, NULL, 'rules', NULL, ?, 0, ?)
       ON CONFLICT(title_key) DO NOTHING`,
    );
    const insertSemantic = this.database.prepare(
      `INSERT OR IGNORE INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const enqueueModel = this.database.prepare(
      `INSERT OR IGNORE INTO title_parse_model_queue (title_key, eligible, failures, frozen)
       VALUES (?, ?, 0, 0)`,
    );
    const now = Date.now();
    this.database.exec('BEGIN');
    try {
      for (const key of newKeys) {
        insertKey.run(
          key.titleKey,
          key.title,
          JSON.stringify(key.parsed.functions),
          key.parsed.levelRank,
          TAXONOMY_VERSION,
          now,
        );
        enqueueModel.run(key.titleKey, isUncertain(key.parsed) ? 1 : 0);
      }
      for (const { row, titleKey, parsed } of resolved) {
        for (const code of parsed.functions) {
          insertSemantic.run(
            row.id,
            code,
            parsed.levelRank,
            titleKey,
            row.published_ms,
            row.is_remote,
          );
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { backfilled: rows.length, newKeys: newKeys.length };
  }

  /** Память порции → кеш `title_parse` (модельный разбор главнее правил) → правила. */
  private resolveTitles(rows: readonly PoolRow[]) {
    const readKey = this.database.prepare(
      'SELECT functions, level_rank FROM title_parse WHERE title_key = ?',
    );
    const known = new Map<string, ParsedTitle>();
    const newKeys: { titleKey: string; title: string; parsed: ParsedTitle }[] = [];
    const resolved = rows.map((row) => {
      const title = row.title?.trim() ?? '';
      const titleKey = normalizeTitleKey(title) || title.toLowerCase();
      let parsed = known.get(titleKey);
      if (!parsed) {
        const cached = readKey.get(titleKey) as
          { functions: string; level_rank: number | null } | undefined;
        parsed = cached
          ? {
              functions: JSON.parse(cached.functions) as FunctionCode[],
              levelRank: cached.level_rank,
            }
          : rulesParseOrOther(title);
        if (!cached) newKeys.push({ titleKey, title, parsed });
        known.set(titleKey, parsed);
      }
      return { row, titleKey, parsed };
    });
    return { resolved, newKeys };
  }

  /**
   * Строки вакансий, ушедших из живого пула, — ограниченной порцией за проход.
   * Поиск — обычным чтением (в WAL не мешает писателям), удаление — коротко по
   * списку rowid: `DELETE … IN (SELECT … JOIN)` держал запись 104 с и ронял
   * старт сервера и записи HTTP (B303).
   */
  private pruneOrphans(): number {
    const from = this.pruneCursor;
    const rowids = this.database
      .prepare(
        `SELECT s.rowid AS rowid FROM vacancy_semantic s
         LEFT JOIN vacancy_pool_index i ON i.id = s.id
         WHERE s.rowid > ? AND s.rowid <= ? AND (i.id IS NULL OR i.expired = 1)
         LIMIT ?`,
      )
      .all(from, from + PRUNE_WINDOW, PRUNE_CHUNK)
      .map((row) => Number(row.rowid));
    if (rowids.length < PRUNE_CHUNK) this.advancePruneCursor(from + PRUNE_WINDOW);
    if (rowids.length === 0) return 0;
    const drop = this.database.prepare('DELETE FROM vacancy_semantic WHERE rowid = ?');
    this.database.exec('BEGIN');
    try {
      const removed = rowids.reduce((total, rowid) => total + Number(drop.run(rowid).changes), 0);
      this.database.exec('COMMIT');
      return removed;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private advancePruneCursor(next: number): void {
    const max = (
      this.database.prepare('SELECT max(rowid) AS m FROM vacancy_semantic').get() as {
        m: number | null;
      }
    ).m;
    this.pruneCursor = max !== null && next < max ? next : 0;
  }
}

function isUncertain(parsed: ParsedTitle): boolean {
  return parsed.functions.includes('other') || parsed.functions.length === 2 || !parsed.roleId;
}

function rulesParseOrOther(title: string): ParsedTitle {
  const parsed = rulesParse(title);
  return parsed.functions.length > 0
    ? parsed
    : { functions: ['other'], levelRank: parsed.levelRank };
}
