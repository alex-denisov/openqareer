import type { CampaignMetaView } from '../../../coach/matchedVacancyApi';

/**
 * Роли фильтра при первом открытии: сохранённый выбор сервера, иначе роли поиска из «Карьеры».
 * Роли «по умолчанию» (кандидат их не выбирал) выбором не считаются — фильтр «Все роли».
 */
export function defaultRoles(
  saved: readonly string[] | undefined,
  campaign: CampaignMetaView['roles'] | undefined,
): readonly string[] {
  if (saved && saved.length > 0) return saved;
  if (!campaign || campaign.origin === 'default') return [];
  return campaign.value;
}
