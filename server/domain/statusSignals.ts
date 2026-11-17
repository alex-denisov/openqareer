import type { CandidateStatusId } from '../../shared/candidateStatus';
import { pluralRu } from '../../shared/pluralRu';
import type { StatusSignal, StatusSignalAnswer, StatusSignalKind } from '../../shared/statusSignal';
import { revertDeadline } from './candidateStatus';

/**
 * B691: сигналы «Сегодня». Чистый расчёт по откликам и сохранённым вакансиям
 * кандидата; пороги — из `status-detection.md` (правила П-01 и П-04), память
 * ответов — из карточки B691: «Нет» выключает сигнал на 30 дней, второе «Нет» —
 * насовсем. Статус сигнал не меняет никогда.
 */

const DAY_MS = 86_400_000;
const SEARCH_WINDOW_DAYS = 7;
const SEARCH_BASELINE_DAYS = 30;
const SEARCH_MIN_APPLICATIONS = 2;
const PROFESSION_WINDOW_DAYS = 21;
const PROFESSION_MIN_SAVES = 4;
const PROFESSION_MIN_SAVE_DAYS = 3;
const PROFESSION_MIN_SHARE = 0.4;
const PROFESSION_MIN_APPLICATIONS = 2;
const RECENT_STAGE_DAYS = 14;
const STATUS_QUIET_DAYS = 14;
const YES_QUIET_DAYS = 14;
const NO_QUIET_DAYS = 30;
const MAX_FACTS = 3;

/** Сигнал выключен насовсем: кандидат дважды ответил «Нет». */
export const SILENT_FOREVER = 'forever';

export interface SignalApplication {
  readonly id: string;
  /** Вакансия отклика: два отклика на одну вакансию — один довод. */
  readonly vacancyKey: string;
  /** Направление вакансии по её названию; `null` — не распознано. */
  readonly functionCode: string | null;
  readonly stage: string;
  readonly createdAt: string;
  /** Когда отклик отправлен; `null` — вакансия только сохранена. */
  readonly appliedAt: string | null;
  readonly stageChangedAt: string;
  /** Отклик ушёл автооткликом, а не руками кандидата. */
  readonly automatic: boolean;
}

export interface SignalAnswerRecord {
  readonly kind: StatusSignalKind;
  readonly answer: StatusSignalAnswer;
  readonly createdAt: string;
}

export interface SignalInput {
  readonly now: Date;
  readonly timezone: string;
  readonly status: CandidateStatusId;
  /** Когда выбран нынешний статус; `null` — кандидат его не выбирал. */
  readonly statusSince: string | null;
  readonly applications: readonly SignalApplication[];
  /** Время пропусков вакансий с причиной «не та роль». */
  readonly roleFamilySkips: readonly string[];
  /** Направления целевых ролей кандидата. */
  readonly targetFunctions: readonly string[];
  readonly functionLabels: Readonly<Record<string, string>>;
  /** Неотменённые ответы кандидата на сигналы. */
  readonly answers: readonly SignalAnswerRecord[];
}

function within(value: string | null, now: Date, days: number): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now.getTime() && now.getTime() - time < days * DAY_MS;
}

function addDays(value: string, days: number): string {
  return new Date(Date.parse(value) + days * DAY_MS).toISOString();
}

/**
 * До какого момента сигнал молчит из-за ответов: время, `SILENT_FOREVER` или
 * `null`, если ответы его не глушат.
 */
export function signalSilentUntil(
  answers: readonly SignalAnswerRecord[],
  kind: StatusSignalKind,
  timezone: string,
): string | null {
  const own = answers.filter((answer) => answer.kind === kind);
  const refusals = own.filter((answer) => answer.answer === 'no');
  if (refusals.length >= 2) return SILENT_FOREVER;
  const until = own.map((answer) => {
    if (answer.answer === 'no') return addDays(answer.createdAt, NO_QUIET_DAYS);
    if (answer.answer === 'yes') return addDays(answer.createdAt, YES_QUIET_DAYS);
    return revertDeadline(new Date(answer.createdAt), timezone);
  });
  return until.reduce<string | null>(
    (latest, value) => (latest === null || Date.parse(value) > Date.parse(latest) ? value : latest),
    null,
  );
}

function silenced(input: SignalInput, kind: StatusSignalKind): boolean {
  const until = signalSilentUntil(input.answers, kind, input.timezone);
  return until === SILENT_FOREVER || (until !== null && Date.parse(until) > input.now.getTime());
}

/** Отправленный отклик остаётся откликом и после архива: архив — уже итог. */
function isManual(application: SignalApplication): boolean {
  return !application.automatic && application.appliedAt !== null;
}

function startedSearch(input: SignalInput): StatusSignal | null {
  if (input.status !== 'looking') return null;
  const applied = input.applications.filter((item) => item.appliedAt);
  const recent = applied.filter((item) => within(item.appliedAt, input.now, SEARCH_WINDOW_DAYS));
  const manual = recent.filter(isManual);
  const vacancies = new Set(manual.map((item) => item.vacancyKey));
  if (manual.length < SEARCH_MIN_APPLICATIONS || vacancies.size < SEARCH_MIN_APPLICATIONS)
    return null;
  const earlier = input.applications.filter(
    (item) =>
      isManual(item) &&
      !within(item.appliedAt, input.now, SEARCH_WINDOW_DAYS) &&
      within(item.appliedAt, input.now, SEARCH_WINDOW_DAYS + SEARCH_BASELINE_DAYS),
  ).length;
  const count = pluralRu(manual.length, ['отклик', 'отклика', 'откликов']);
  const facts = [`${count} за неделю, раньше ${earlier}`];
  if (recent.every((item) => !item.automatic)) facts.push('Отправили сами, не автооткликами');
  return {
    kind: 'started_search',
    question: { before: 'Похоже, вы ', accent: 'начали искать работу', after: '. Верно?' },
    facts,
    suggest: { status: 'job_search', targetProfession: null },
  };
}

function localDay(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(value));
}

interface Direction {
  readonly code: string;
  readonly saves: readonly SignalApplication[];
  readonly manual: readonly SignalApplication[];
}

function foreignDirections(input: SignalInput): readonly Direction[] {
  const own = new Set(input.targetFunctions);
  const recent = input.applications.filter(
    (item) =>
      item.stage !== 'archived' && within(item.createdAt, input.now, PROFESSION_WINDOW_DAYS),
  );
  const codes = new Set(
    recent.flatMap((item) =>
      item.functionCode && !own.has(item.functionCode) ? [item.functionCode] : [],
    ),
  );
  return [...codes].flatMap((code) => {
    const saves = recent.filter((item) => item.functionCode === code);
    const manual = input.applications.filter(
      (item) =>
        item.functionCode === code &&
        isManual(item) &&
        within(item.appliedAt, input.now, PROFESSION_WINDOW_DAYS),
    );
    const days = new Set(saves.map((item) => localDay(item.createdAt, input.timezone)));
    const bySaves =
      saves.length >= PROFESSION_MIN_SAVES &&
      days.size >= PROFESSION_MIN_SAVE_DAYS &&
      saves.length / recent.length >= PROFESSION_MIN_SHARE;
    return bySaves || manual.length >= PROFESSION_MIN_APPLICATIONS ? [{ code, saves, manual }] : [];
  });
}

function changingProfession(input: SignalInput): StatusSignal | null {
  if (input.status !== 'job_search' && input.status !== 'looking') return null;
  if (input.targetFunctions.length === 0) return null;
  const inProcess = input.applications.some(
    (item) =>
      (item.stage === 'interview' || item.stage === 'offer') &&
      within(item.stageChangedAt, input.now, RECENT_STAGE_DAYS),
  );
  if (inProcess) return null;
  const [direction] = [...foreignDirections(input)]
    .filter((item) => input.functionLabels[item.code])
    .sort((a, b) => b.saves.length - a.saves.length || a.code.localeCompare(b.code));
  if (!direction) return null;
  const label = input.functionLabels[direction.code];
  const skips = input.roleFamilySkips.filter((at) => within(at, input.now, PROFESSION_WINDOW_DAYS));
  const facts = [
    `За 3 недели сохранили ${pluralRu(direction.saves.length, ['вакансию', 'вакансии', 'вакансий'])} этого направления`,
    direction.manual.length > 0 ? `Откликнулись на ${direction.manual.length} из них` : null,
    skips.length > 0
      ? `Пропустили ${pluralRu(skips.length, ['вакансию', 'вакансии', 'вакансий'])} с причиной «не та роль»`
      : null,
  ].filter((fact): fact is string => fact !== null);
  return {
    kind: 'changing_profession',
    question: {
      before: 'Смотрите вакансии по направлению ',
      accent: label,
      after: '. Хотите сменить профессию?',
    },
    facts: facts.slice(0, MAX_FACTS),
    suggest: { status: 'changing_profession', targetProfession: label },
  };
}

/** Порядок важности: смена профессии идёт раньше начала поиска. На экране сигнал один. */
const DETECTORS: readonly (readonly [
  StatusSignalKind,
  (input: SignalInput) => StatusSignal | null,
])[] = [
  ['changing_profession', changingProfession],
  ['started_search', startedSearch],
];

export function detectStatusSignal(input: SignalInput): StatusSignal | null {
  // Только что выбранный статус не оспариваем: 14 дней сигналы молчат.
  if (within(input.statusSince, input.now, STATUS_QUIET_DAYS)) return null;
  for (const [kind, detect] of DETECTORS) {
    if (silenced(input, kind)) continue;
    const signal = detect(input);
    if (signal) return signal;
  }
  return null;
}
