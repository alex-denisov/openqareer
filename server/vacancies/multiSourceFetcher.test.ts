import { describe, expect, it } from 'vitest';
import { buildMultiSourceFetcher } from './multiSourceFetcher';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';

const refuse = () => {
  throw new Error('the fetcher must not reach any platform in this test');
};

/**
 * B199 — площадки за анти-ботом и площадки, запретившие обход словами в
 * robots.txt, остаются в реестре по требованию владельца, но сервер не имеет
 * права их опрашивать. Молчаливый пустой успех здесь опаснее ошибки: он
 * выглядел бы как «площадка сегодня без вакансий».
 */
describe('multi-source fetcher (B199)', () => {
  const browserOnly: VacancySourceConfig = {
    id: 'src-linkedin',
    name: 'LinkedIn Jobs',
    type: 'browser_session',
    enabled: false,
    targetUrl: 'https://www.linkedin.com/jobs/search/',
    refreshIntervalMinutes: 120,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };

  it('refuses a browser-session source instead of reporting an empty success', async () => {
    const fetcher = buildMultiSourceFetcher(refuse, refuse);

    await expect(fetcher(browserOnly)).rejects.toThrow(
      'vacancy_source_type_unsupported: browser_session',
    );
  });
});
