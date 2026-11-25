/**
 * Последнее показанное содержимое разделов кабинета (B589).
 *
 * Разделы рендерятся по `activeView` и при уходе размонтируются, поэтому
 * повторный вход раньше снова ждал сеть. Хук раздела берёт отсюда то, что
 * кандидат видел в прошлый раз, показывает сразу и обновляет данные в фоне
 * (stale-while-revalidate).
 *
 * Только память вкладки: в хранилище браузера ничего нового не пишется,
 * перезапуск приложения начинает с чистого листа. Записи принадлежат одному
 * кандидату: смена кандидата или выход очищают всё, чтобы чужой профиль не
 * мелькнул даже на кадр.
 */
import { clearEarlyReads } from './earlyRead';

const entries = new Map<string, unknown>();
let owner: string | null = null;
let revision = 0;

/** Меняется при правке, выходе и смене кандидата: чтение, начатое раньше, в кэш не пишет. */
export function sectionCacheRevision(): number {
  return revision;
}

/** Called by the shell on every render with the signed-in candidate (or none). */
export function bindSectionCacheOwner(candidateId: string | null | undefined): void {
  const next = candidateId || null;
  if (next === owner) return;
  // Чтения, начатые до ответа о сессии, принадлежат первому вошедшему, но не следующему.
  if (owner) clearEarlyReads();
  revision += 1;
  entries.clear();
  owner = next;
}

export function readSectionCache<T>(key: string): T | undefined {
  if (!owner) return undefined;
  return entries.get(key) as T | undefined;
}

export function writeSectionCache<T>(key: string, value: T): void {
  if (!owner) return;
  entries.set(key, value);
}

/** После своей правки: прежнее чтение больше не показываем, в том числе начатое до неё. */
export function dropSectionCache(...keys: readonly string[]): void {
  clearEarlyReads();
  revision += 1;
  keys.forEach((key) => entries.delete(key));
}

export function clearSectionCache(): void {
  clearEarlyReads();
  revision += 1;
  entries.clear();
  owner = null;
}

/** Ключи разделов: одно место, чтобы два хука не делили запись случайно. */
export const SECTION_CACHE_KEYS = {
  today: 'today:snapshot',
  matchedPool: 'vacancies:matched-pool',
  matchedPoolLatest: 'vacancies:matched-pool-latest',
  vacancyApplications: 'vacancies:applications',
  applications: 'responses:applications-page',
  resumeStudio: 'profile:resume-studio',
  careerStatus: 'career:status',
  careerCampaign: 'career:campaign',
  careerRoles: 'career:roles',
  careerSkills: 'career:skills',
  automationSnapshot: 'automation:snapshot',
  automationQueue: 'automation:queue',
  automationJournal: 'automation:journal',
} as const;
