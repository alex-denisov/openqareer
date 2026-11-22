import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CANDIDATE_TABLE_COVERAGE } from './candidateExportCoverage';
import { SqliteDiaryCheckpointRepository } from './sqliteDiaryCheckpointRepository';
import { SqliteDiaryDetailsRepository } from './sqliteDiaryDetailsRepository';
import { SqliteDiaryPeopleRepository } from './sqliteDiaryPeopleRepository';
import { SqliteKpiImportRepository } from './sqliteKpiImportRepository';
import { createCandidate, createStore, directories } from './sqliteTestHarness';

const KEY = Buffer.alloc(32, 4);

function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-export-coverage-'));
  directories.push(directory);
  const databasePath = join(directory, 'candidate.sqlite');
  return { databasePath, store: createStore(databasePath) };
}

const OWNER_TABLES = new Set(['candidates']);

/**
 * Таблицы базы кандидата: со столбцом `candidate_id` или со ссылкой на таблицу кандидата,
 * в том числе через другие таблицы (`users` → `billing_*`, `applications` → `application_offers`).
 */
function candidateTables(databasePath: string): string[] {
  const database = new DatabaseSync(databasePath);
  try {
    const names = (
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map(({ name }) => name);
    const links = new Map(
      names.map((name) => [
        name,
        (database.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{ table: string }>).map(
          (link) => link.table,
        ),
      ]),
    );
    const owned = new Set(
      names.filter((name) =>
        (database.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).some(
          (column) => column.name === 'candidate_id',
        ),
      ),
    );
    let grew = true;
    while (grew) {
      grew = false;
      for (const name of names) {
        if (owned.has(name) || OWNER_TABLES.has(name)) continue;
        if ((links.get(name) ?? []).some((table) => owned.has(table) || OWNER_TABLES.has(table))) {
          owned.add(name);
          grew = true;
        }
      }
    }
    return [...owned].sort();
  } finally {
    database.close();
  }
}

const SERVER = join(import.meta.dirname, '..');

/**
 * Таблицы кандидата из `CREATE TABLE` в исходниках сервера: так в сверку попадают и таблицы,
 * которые создаёт маршрут под флагом или отдельный репозиторий, а не хранилище при старте.
 */
function declaredCandidateTables(): string[] {
  const files = readdirSync(SERVER, { recursive: true, encoding: 'utf8' }).filter(
    (file) => file.endsWith('.ts') && !file.includes('.test.'),
  );
  const tables = new Set<string>();
  for (const file of files) {
    const statements = readFileSync(join(SERVER, file), 'utf8').split(
      /(?=CREATE\s+(?:VIRTUAL\s+)?(?:TABLE|INDEX|UNIQUE|TRIGGER|VIEW))/i,
    );
    for (const statement of statements) {
      const table = /^CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/i.exec(statement)?.[1];
      if (table && /candidate_id|REFERENCES\s+(?:candidates|users|applications)\b/i.test(statement)) tables.add(table);
    }
  }
  return [...tables];
}

const goalInput = {
  title: 'Снизить число инцидентов P1',
  type: 'operational' as const,
  horizon: 'quarter' as const,
  startDate: '2026-12-01',
  dueDate: '2026-12-31',
  unit: 'инцидентов в месяц',
  baselineValue: 9,
  targetValue: 4,
};

const person = (id: string, name: string) => ({
  id,
  name,
  role: 'CTO',
  group: 'Руководитель',
  cadence: 'weekly' as const,
  headcount: 1,
  lastMetOn: null,
  meeting: null,
  createdAt: '2026-12-02T10:00:00.000Z',
});

/** Пишет весь дневник кандидата так, как пишут маршруты: через свои соединения с базой. */
function seedDiary(store: ReturnType<typeof createStore>, databasePath: string, candidateId: string, tag: string) {
  const diary = store.careerDiaryRepo;
  const goal = diary.createGoal(candidateId, { ...goalInput, title: `Цель ${tag}` });
  diary.recordMeasurement(candidateId, goal.id, { measuredAt: '2026-12-10', value: 6, note: `Замер ${tag}` });
  diary.upsertWeeklyReview(candidateId, {
    weekStart: '2026-12-07',
    movedForward: `Неделя ${tag}`,
    blockers: 'Нет.',
    learning: 'Нет.',
    risks: 'Нет.',
    nextWeek: 'Нет.',
  });
  diary.createAchievement(candidateId, { situation: `Ситуация ${tag}`, action: 'Действие.', result: 'Итог.' });
  const workplace = diary.createWorkplace(candidateId, {
    company: `Компания ${tag}`,
    title: 'Head of Engineering',
    startDate: '2026-11-03',
    endDate: null,
  });
  const options = { databasePath, encryptionKey: KEY };
  const details = new SqliteDiaryDetailsRepository(options);
  details.saveGoalDetail(candidateId, goal.id, { setBy: 'manager', agreedOn: '2026-12-01', weight: 40, archive: null });
  details.saveAdaptationDetails(candidateId, workplace.id, {
    tasks: {},
    stages: {},
    probation: { endsOn: '2027-02-03', reviewer: `Проверяющий ${tag}` },
    firstMeeting: null,
    relocated: null,
  });
  details.close();
  const people = new SqliteDiaryPeopleRepository(options);
  people.save(candidateId, workplace.id, person(`person-${tag}`, `Человек ${tag}`));
  people.close();
  const checkpoints = new SqliteDiaryCheckpointRepository(options);
  checkpoints.save(candidateId, workplace.id, 'day30', { sentOn: '2026-12-03' });
  checkpoints.close();
  const kpi = new SqliteKpiImportRepository(options);
  kpi.create(candidateId, 'text', { name: null, mimeType: 'text/plain', content: `KPI ${tag}` }, []);
  kpi.close();
  return { goalId: goal.id, workplaceId: workplace.id };
}

describe('B689: выгрузка данных покрывает все таблицы кандидата', () => {
  it('у каждой таблицы кандидата в схеме есть строка покрытия, и лишних строк нет', () => {
    const { databasePath } = fileStore();
    const tables = [...new Set([...candidateTables(databasePath), ...declaredCandidateTables()])].sort();

    expect(tables.filter((table) => !(table in CANDIDATE_TABLE_COVERAGE))).toEqual([]);
    expect(Object.keys(CANDIDATE_TABLE_COVERAGE).filter((table) => !tables.includes(table))).toEqual([]);
  });

  it('таблицы дневника с содержимым кандидата все в выгрузке', () => {
    const diaryGaps = Object.entries(CANDIDATE_TABLE_COVERAGE).filter(
      ([table, coverage]) => table.startsWith('career_diary_') && 'gap' in coverage,
    );
    expect(diaryGaps).toEqual([]);
  });

  it('n02: «Как часто» и «Не показывать название компании» входят в выгрузку', () => {
    const { store } = fileStore();
    const candidate = createCandidate(store);
    expect(store.exportCandidate(candidate.id).notificationDeliverySettings).toEqual({ frequency: 'immediate', hideCompany: false });
    store.notificationRepository.setDeliverySettings(candidate.id, { frequency: 'weekly', hideCompany: true });
    expect(store.exportCandidate(candidate.id).notificationDeliverySettings).toEqual({ frequency: 'weekly', hideCompany: true });
  });

  it('выгрузка без флага B640 не создаёт таблицы дневника', () => {
    const { databasePath, store } = fileStore();
    const candidate = createCandidate(store);
    expect(store.exportCandidate(candidate.id).careerDiary.people).toEqual([]);

    const database = new DatabaseSync(databasePath);
    const created = database
      .prepare(
        `SELECT name FROM sqlite_master WHERE name IN
         ('career_diary_people', 'career_diary_kpi_imports', 'career_diary_checkpoints', 'career_diary_goal_details')`,
      )
      .all();
    database.close();
    expect(created).toEqual([]);
  });

  it('каждый ключ покрытия есть в ответе выгрузки', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const exported = store.exportCandidate(candidate.id);
    const keys = new Set(
      Object.values(CANDIDATE_TABLE_COVERAGE).flatMap((coverage) => ('export' in coverage ? [coverage.export] : [])),
    );

    expect([...keys].filter((key) => !(key in exported))).toEqual([]);
  });

  it('в выгрузке весь дневник кандидата и ничего от чужого', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const other = createCandidate(store);
    const { goalId, workplaceId } = seedDiary(store, databasePath, own.id, 'своя');
    seedDiary(store, databasePath, other.id, 'чужая');

    const exported = store.exportCandidate(own.id);
    const diary = exported.careerDiary;

    expect(diary.goals.map((goal) => goal.title)).toEqual(['Цель своя']);
    expect(diary.measurements.map((measurement) => [measurement.goalId, measurement.note])).toEqual([[goalId, 'Замер своя']]);
    expect(diary.goalDetails).toEqual([
      { goalId, details: { setBy: 'manager', agreedOn: '2026-12-01', weight: 40, archive: null } },
    ]);
    expect(diary.weeklyReviews.map((review) => review.movedForward)).toEqual(['Неделя своя']);
    expect(diary.achievements.map((achievement) => achievement.situation)).toEqual(['Ситуация своя']);
    expect(diary.workplaces.map((workplace) => workplace.company)).toEqual(['Компания своя']);
    expect(diary.adaptationDetails).toMatchObject([
      { workplaceId, details: { probation: { endsOn: '2027-02-03', reviewer: 'Проверяющий своя' } } },
    ]);
    expect(diary.people).toMatchObject([{ workplaceId, person: { name: 'Человек своя' } }]);
    expect(diary.checkpoints).toEqual([{ workplaceId, kind: 'day30', mark: { sentOn: '2026-12-03' } }]);
    expect(diary.kpiImports).toMatchObject([{ sourceKind: 'text', source: { content: 'KPI своя' } }]);
    expect(JSON.stringify(exported)).not.toContain('чужая');
    // Прежние ключи на месте.
    expect(exported.careerDiaryEntries).toEqual({ entries: [], weekSummaries: [] });
    expect(exported.interviewPractices).toEqual([]);
  });

  it('удаление кандидата стирает его дневник каскадом', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    seedDiary(store, databasePath, own.id, 'своя');

    expect(store.deleteCandidate(own.id)).toBe(true);
    const database = new DatabaseSync(databasePath);
    try {
      const left = candidateTables(databasePath)
        .filter((table) => table.startsWith('career_diary_'))
        .filter((table) => {
          const row = database.prepare(`SELECT COUNT(*) AS total FROM "${table}" WHERE candidate_id = ?`).get(own.id) as { total: number };
          return Number(row.total) > 0;
        });
      expect(left).toEqual([]);
    } finally {
      database.close();
    }
  });
});
