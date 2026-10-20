import { randomUUID } from 'node:crypto';
import type { CandidateStore } from '../data/candidateStore';
import type { ResumeDraft } from './resumeDraft';

type ExperienceEntry = ResumeDraft['experience'][number];
type FactField = readonly [string, unknown];

export function factStatement(title: string, fields: readonly FactField[]): string | null {
  const lines = fields.flatMap(([label, value]) => {
    if (typeof value === 'boolean') return [`${label}: ${value ? 'Да' : 'Нет'}`];
    const content = typeof value === 'string' ? value.trim() : '';
    return content ? [`${label}: ${content}`] : [];
  });
  return lines.length ? `${title}\n${lines.join('\n')}` : null;
}

export function experienceStatement(entry: ExperienceEntry): string | null {
  const details = [
    entry.title,
    entry.employer,
    entry.location,
    entry.startDate,
    entry.endDate,
    entry.employmentType,
    entry.workplaceType,
    ...(entry.skills ?? []),
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
  if (!details) return null;
  return factStatement('Место работы', [
    ['Должность', entry.title],
    ['Работодатель', entry.employer],
    ['Локация', entry.location],
    ['Начало', entry.startDate],
    ['Окончание', entry.endDate],
    ['Текущая роль', entry.current],
    ['Занятость', entry.employmentType],
    ['Формат работы', entry.workplaceType],
    ['Размер команды', entry.teamSize ? `${entry.teamSize} человек` : undefined],
    [
      'Навыки на этом месте',
      (entry.skills ?? [])
        .map((skill) => skill.trim())
        .filter(Boolean)
        .join(', '),
    ],
  ]);
}

export function createCandidateExperienceChronologyEvidence(
  store: Pick<CandidateStore, 'addManualExperienceFact'>,
  candidateId: string,
  entry: ExperienceEntry,
): string | null {
  const statement = experienceStatement(entry);
  if (!statement) return null;
  const memoryId = randomUUID();
  store.addManualExperienceFact(candidateId, memoryId, statement);
  return memoryId;
}
