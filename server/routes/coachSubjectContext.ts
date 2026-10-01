import type { CoachTurnSubject } from '../domain/coach';
import type { RouteDeps } from './deps';

/**
 * Формирует краткий контекстный блок фактов о вакансии для модели.
 * Требования ограничены первыми 15.
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
    .filter((m) => m.kind === 'fact' && (m.domain === 'skill' || m.confidence === 'candidate-confirmed'))
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

  const lines: string[] = [];
  if (title) lines.push(`Вакансия: ${title}`);
  if (company) lines.push(`Компания: ${company}`);
  if (location) lines.push(`Локация: ${location}`);
  if (reqSkills.length > 0) lines.push(`Требования: ${reqSkills.join(', ')}`);
  if (matching.length > 0) lines.push(`Совпадения с профилем: ${matching.join(', ')}`);
  if (gaps.length > 0) lines.push(`Пробелы с профилем: ${gaps.join(', ')}`);
  return lines.join('\n');
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
    : app.clusterId ?? undefined;
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
  if (subject.kind === 'vacancy') {
    return buildVacancyContext(deps, candidateId, subject.id);
  }
  if (subject.kind === 'application') {
    return buildApplicationContext(deps, candidateId, subject.id);
  }
  if (subject.kind === 'interview') {
    return buildInterviewContext(deps, candidateId, subject.id);
  }
  return null;
}
