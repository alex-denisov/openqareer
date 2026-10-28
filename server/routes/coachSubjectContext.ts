import { workFormatLabel } from '../../shared/vacancyWorkFormat';
import type { VacancyCluster, VacancySalary } from '../domain/unifiedVacancy';
import { buildAdaptationContext } from './adaptationCoach';
import type { CoachTurnSubject } from '../domain/coach';
import { candidateCompanyCoachContext } from './candidateCompanyRoutes';
import type { RouteDeps } from './deps';

/** stageContext у модели ограничен 10 000 символов; текст вакансии берёт остаток. */
const STAGE_CONTEXT_MAX_CHARS = 10_000;
const VACANCY_TEXT_MAX_CHARS = 6_000;

function salaryLine(salary: VacancySalary | undefined): string | null {
  if (!salary || (salary.from === undefined && salary.to === undefined)) return null;
  const amount = (value: number) => value.toLocaleString('ru-RU').replace(/\s/gu, ' ');
  const range = [salary.from, salary.to]
    .filter((value): value is number => typeof value === 'number')
    .map(amount)
    .join('–');
  const tax = salary.gross === undefined ? '' : salary.gross ? ' до вычета налогов' : ' на руки';
  return `Зарплата: ${range}${salary.currency ? ` ${salary.currency}` : ''}${tax}`;
}

/** Условия вакансии: зарплата, формат и источник — то, о чём модель говорила «нет данных». */
function conditionLines(
  cluster: VacancyCluster | undefined,
  full: { readonly salary?: VacancySalary; readonly url?: string } | undefined,
): string[] {
  const format = cluster?.workFormat ? workFormatLabel(cluster.workFormat) : undefined;
  const url = cluster?.primaryUrl ?? full?.url;
  return [
    salaryLine(cluster?.salary ?? full?.salary),
    format ? `Формат работы: ${format}` : null,
    url ? `Источник: ${url}` : null,
  ].filter((line): line is string => Boolean(line));
}

/**
 * Полный текст вакансии тем же чтением, что и «Подробнее» (B266). Без него модель
 * видела только название и навыки и отвечала «нет данных по вакансии» (28.10).
 */
async function vacancyText(
  deps: RouteDeps,
  vacancyId: string,
  cluster: VacancyCluster | undefined,
): Promise<string> {
  const sourceId = vacancyId.replace(/^cluster-/u, '');
  const loaded = await deps.multiSourceEngine
    ?.loadVacancyDescription?.(sourceId)
    .catch(() => undefined);
  const full = loaded?.vacancy ?? deps.multiSourceEngine?.getVacancy?.(sourceId);
  const texts = [full?.fullDescription, full?.description, cluster?.descriptionSummary]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
  const longest = texts.reduce((best, value) => (value.length > best.length ? value : best), '');
  return longest.slice(0, VACANCY_TEXT_MAX_CHARS);
}

/**
 * Формирует контекстный блок фактов о вакансии для модели: условия, источник и
 * текст вакансии. Требования ограничены первыми 15.
 */
async function buildVacancyContext(
  deps: RouteDeps,
  candidateId: string,
  vacancyId: string,
): Promise<string | null> {
  const cluster =
    deps.multiSourceEngine?.getActiveCluster?.(vacancyId) ??
    deps.multiSourceEngine?.getPublicCatalogCluster?.(vacancyId);
  const full = !cluster ? deps.multiSourceEngine?.getVacancy?.(vacancyId) : undefined;
  if (!cluster && !full) return null;

  const title = cluster?.canonicalTitle ?? full?.title;
  const company = cluster?.canonicalCompany ?? full?.company;
  const location = cluster?.canonicalLocation ?? full?.location;
  const rawSkills = cluster?.skills ?? full?.requiredSkills ?? [];
  const reqSkills = rawSkills.slice(0, 15);

  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const memory = snapshot?.memory ?? [];
  const confirmedSkills = memory
    .filter(
      (m) => m.kind === 'fact' && (m.domain === 'skill' || m.confidence === 'candidate-confirmed'),
    )
    .map((m) => m.statement.trim().toLowerCase());
  const skillSet = new Set(confirmedSkills);

  const matching: string[] = [];
  const gaps: string[] = [];
  for (const s of reqSkills) {
    if (skillSet.has(s.trim().toLowerCase())) {
      matching.push(s);
    } else {
      gaps.push(s);
    }
  }

  const lines = [
    title && `Вакансия: ${title}`,
    company && `Компания: ${company}`,
    location && `Локация: ${location}`,
    ...conditionLines(cluster, full),
  ].filter((line): line is string => Boolean(line));
  if (reqSkills.length > 0) lines.push(`Требования: ${reqSkills.join(', ')}`);
  if (matching.length > 0) lines.push(`Совпадения с профилем: ${matching.join(', ')}`);
  if (gaps.length > 0) lines.push(`Пробелы с профилем: ${gaps.join(', ')}`);
  const facts = lines.join('\n');
  const text = await vacancyText(deps, vacancyId, cluster);
  if (!text) return facts;
  const room = STAGE_CONTEXT_MAX_CHARS - facts.length - '\nТекст вакансии:\n'.length;
  return `${facts}\nТекст вакансии:\n${text.slice(0, Math.max(0, room))}`;
}

/**
 * Формирует контекстный блок для отклика кандидата.
 * Чужой или несуществующий отклик возвращает null -> 404.
 */
function buildApplicationContext(
  deps: RouteDeps,
  candidateId: string,
  applicationId: string,
): string | null {
  const app = deps.candidateStore.getApplication(candidateId, applicationId);
  if (!app) return null;

  const lines: string[] = [];
  const vacancyTitle = app.vacancy?.title
    ? `${app.vacancy.title}${app.vacancy.company ? ` (${app.vacancy.company})` : ''}`
    : (app.clusterId ?? undefined);
  if (vacancyTitle) lines.push(`Вакансия: ${vacancyTitle}`);
  if (app.stage) lines.push(`Этап: ${app.stage}`);
  const dates: string[] = [];
  if (app.createdAt) dates.push(`создан ${app.createdAt.slice(0, 10)}`);
  if (app.stageChangedAt && app.stageChangedAt !== app.createdAt) {
    dates.push(`изменён ${app.stageChangedAt.slice(0, 10)}`);
  }
  if (dates.length > 0) lines.push(`Даты: ${dates.join(', ')}`);
  if (app.notes && app.notes.trim()) lines.push(`Заметка: ${app.notes.trim()}`);
  return lines.join('\n');
}

/**
 * Формирует контекстный блок для интервью кандидата.
 * Чужое или несуществующее интервью возвращает null -> 404.
 */
function buildInterviewContext(
  deps: RouteDeps,
  candidateId: string,
  interviewId: string,
): string | null {
  const item = deps.candidateStore.getInterviewSubject(candidateId, interviewId);
  if (!item) return null;

  const lines: string[] = [];
  const vacancyTitle = item.vacancyTitle
    ? `${item.vacancyTitle}${item.vacancyCompany ? ` (${item.vacancyCompany})` : ''}`
    : undefined;
  if (vacancyTitle) lines.push(`Вакансия: ${vacancyTitle}`);
  if (item.scheduledAt) lines.push(`Дата: ${item.scheduledAt}`);
  if (item.stage) lines.push(`Этап: ${item.stage}`);
  return lines.join('\n');
}

/**
 * Строит блок контекста для хода консультанта при переданном subject.
 * Возвращает null, если объект не найден или принадлежит другому кандидату (B340 §3.3).
 */
export async function buildCoachSubjectContext(
  deps: RouteDeps,
  candidateId: string,
  subject: CoachTurnSubject,
): Promise<string | null> {
  if (subject.kind === 'adaptation') return buildAdaptationContext(deps, candidateId, subject);
  if (subject.kind === 'vacancy') {
    return buildVacancyContext(deps, candidateId, subject.id);
  }
  if (subject.kind === 'application') {
    return buildApplicationContext(deps, candidateId, subject.id);
  }
  if (subject.kind === 'company') {
    return candidateCompanyCoachContext(deps, candidateId, subject.id);
  }
  if (subject.kind === 'interview') {
    return buildInterviewContext(deps, candidateId, subject.id);
  }
  return null;
}
