import type { DatabaseSync } from 'node:sqlite';
import type { SourceReading } from './multiSourceVacancyEngine';
import { buildJsonVacancy, fromIso, isUsableVacancy } from './jsonVacancyRecord';
import { isPoolJobReadingEnabled, readPoolJobCards } from '../linkedinPool/jobSearchStore';
import { LINKEDIN_SOURCE_ID } from './linkedinGuestSource';

/**
 * LinkedIn через пул сервисных аккаунтов — дополнение к гостевому поиску
 * (решение владельца 2026-11-03). Карточки пишет исполнитель пула, а здесь они
 * отдаются движку. Сохранён id `src-linkedin-crawler`, зарегистрированный в
 * реестре. Чтение всегда частичное: срез не заменяется никогда.
 */
export const LINKEDIN_POOL_SOURCE_ID = 'src-linkedin-crawler';
const MAX_CARDS_PER_READING = 3_000;

export interface LinkedinPoolReadOptions {
  readonly now: Date;
  readonly observedAt: string;
  /** Спрашивает пул вакансий по id записи; гостевая запись приоритетна. */
  readonly hasVacancy: (id: string) => boolean;
}

export function readLinkedinPoolJobs(
  database: DatabaseSync,
  options: LinkedinPoolReadOptions,
): SourceReading {
  const empty: SourceReading = { vacancies: [], partial: true };
  let cards;
  try {
    if (!isPoolJobReadingEnabled(database)) return empty;
    cards = readPoolJobCards(database, options.now, MAX_CARDS_PER_READING);
  } catch {
    // Таблицы ещё нет (исполнитель не запускался): источник просто пуст.
    return empty;
  }
  const vacancies = cards
    .filter((card) => !options.hasVacancy(`${LINKEDIN_SOURCE_ID}:${card.jobId}`))
    .map((card) =>
      buildJsonVacancy({
        sourceId: LINKEDIN_POOL_SOURCE_ID,
        context: {
          observedAt: options.observedAt,
          sourceName: 'LinkedIn',
          sourceUrl: card.url,
        },
        externalId: card.jobId,
        title: card.title,
        company: card.company,
        location: card.location || undefined,
        isRemote: /remote/i.test(card.location),
        description: [card.title, card.company, card.location].filter(Boolean).join(' — '),
        skills: [],
        url: card.url,
        publishedAt: card.publishedAt ? fromIso(card.publishedAt) : options.observedAt,
      }),
    );
  return { vacancies: vacancies.filter(isUsableVacancy), partial: true };
}
