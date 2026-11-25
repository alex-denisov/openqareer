import type { ApplicationStage } from '../../shared/applicationStage';

const ROW_PREFIX = 'cluster-';

/** Вакансия, по которой ищем отправленный отклик. */
export interface SentLookup {
  readonly clusterId: string;
  readonly title?: string;
  readonly urls: readonly (string | null | undefined)[];
}

interface Candidate {
  readonly clusterId: string | null;
  readonly stage: ApplicationStage;
  readonly vacancy?: { readonly title?: string; readonly url?: string | null } | null;
}

function rowId(id: string): string {
  return id.startsWith(ROW_PREFIX) ? id.slice(ROW_PREFIX.length) : id;
}

function postingKey(url: string | null | undefined, title: string | undefined): string | null {
  if (!url || !title?.trim()) return null;
  return `${url.trim().replace(/#.*$/u, '').replace(/\/+$/u, '')}\n${title.trim().toLocaleLowerCase('und')}`;
}

/** Отклик отправлен: стадия после «сохранено», не архив. */
export function isSentStage(stage: ApplicationStage): boolean {
  return stage !== 'saved' && stage !== 'archived';
}

/**
 * B801: отправленный отклик на эту же вакансию. Карточка та же, если совпал id строки или
 * кластера либо и адрес объявления, и название: склейка меняет id, и черновик стоит рядом дублем.
 */
export function findSentApplication<T extends Candidate>(
  applications: readonly T[],
  { clusterId, title, urls }: SentLookup,
): T | undefined {
  const id = rowId(clusterId);
  const postings = new Set(urls.map((url) => postingKey(url, title)).filter((key) => key !== null));
  const sent = applications.filter((application) => isSentStage(application.stage));
  const samePosting = (application: T): boolean => {
    const key = postingKey(application.vacancy?.url, application.vacancy?.title);
    return key !== null && postings.has(key);
  };
  return (
    sent.find(({ clusterId: own }) => own !== null && rowId(own) === id) ?? sent.find(samePosting)
  );
}
