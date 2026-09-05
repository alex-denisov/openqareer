import { describe, expect, it } from 'vitest';
import { atsBoardSource, ATS_BOARD_SOURCES } from './atsBoardSources';
import { hasJsonAdapter } from './jsonSourceAdapters';

describe('доска работодателя как источник', () => {
  it('строит источник с замеренным адресом и именем компании', () => {
    const source = atsBoardSource({
      company: 'Cloudflare',
      provider: 'greenhouse',
      board: 'cloudflare',
      jobs: 331,
      observedAt: '2026-09-05',
      lists: ['drive'],
    });

    expect(source).toMatchObject({
      id: 'ats-greenhouse-cloudflare',
      // Имя источника — имя работодателя: его же читает разбор записи там, где
      // доска работодателя не публикует (Lever, Ashby).
      name: 'Cloudflare',
      type: 'json_api',
      accessClass: 'api',
      addressStatus: 'live',
      enabled: true,
      targetUrl: 'https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=true',
    });
    expect(hasJsonAdapter(source.id)).toBe(true);
  });

  it('выключает провайдера, который запретил обход словами', () => {
    const source = atsBoardSource({
      company: 'Bosch Group',
      provider: 'smartrecruiters',
      board: 'BoschGroup',
      jobs: 4811,
      observedAt: '2026-09-05',
      lists: [],
    });

    expect(source.enabled).toBe(false);
    expect(source.addressStatus).toBe('robots_forbidden');
    expect(source.disabledReason).toContain('LinkedInBot');
  });

  it('каждый зарегистрированный источник опирается на замер и умеет разбираться', () => {
    expect(ATS_BOARD_SOURCES.length).toBeGreaterThan(0);
    for (const source of ATS_BOARD_SOURCES) {
      expect(hasJsonAdapter(source.id)).toBe(true);
      expect(source.targetUrl.startsWith('https://')).toBe(true);
      expect(source.name.trim().length).toBeGreaterThan(0);
      if (!source.enabled) expect(source.disabledReason).toBeTruthy();
    }
  });

  it('одна компания на одном провайдере регистрируется один раз', () => {
    const ids = ATS_BOARD_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('доски работодателей подключены к продукту, а не лежат рядом', () => {
  it('реестр по умолчанию отдаёт доски вместе с площадками', async () => {
    const { DEFAULT_VACANCY_SOURCES } = await import('./defaultVacancySources');
    const ids = DEFAULT_VACANCY_SOURCES.map((source) => source.id);
    expect(ids).toContain('src-remoteok');
    for (const board of ATS_BOARD_SOURCES) expect(ids).toContain(board.id);
  });

  it('движок берёт доску в плановый опрос и зовёт её замеренный адрес', async () => {
    const { MultiSourceVacancyEngine } = await import('./multiSourceVacancyEngine');
    const asked: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      fetcher: async (source) => {
        asked.push(source.targetUrl);
        return [];
      },
    });
    const board = ATS_BOARD_SOURCES.find((source) => source.enabled);
    expect(board).toBeDefined();
    await engine.syncSource(board!.id);
    expect(asked).toContain(board!.targetUrl);
  });
});
