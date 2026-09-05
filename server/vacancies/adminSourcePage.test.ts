import { describe, expect, it } from 'vitest';
import { ADMIN_VACANCY_PAGE_BYTE_BUDGET } from './adminVacancyPage';
import { buildAdminSourcePage } from './adminSourcePage';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';

/**
 * B200 — регресс, найденный проверкой на проде: здоровье площадок раздуло
 * `GET /api/v1/admin/vacancy-sources` до 29 788 байт, и прод оборвал тело на
 * 20 220 байтах — ровно там же, где рвал подбор (INC-029), снимок кандидата
 * (INC-030) и список вакансий (INC-032). Экран источников показывал пустоту.
 */
function sourcesWithHealth() {
  const engine = new MultiSourceVacancyEngine();
  const health = new Map(
    engine.getSourceHealthReport().map((item) => [item.sourceId, item]),
  );
  return engine.getSources().map((source) => {
    const measured = health.get(source.id);
    return measured
      ? { ...source, health: { liveness: measured.liveness, trust: measured.trust } }
      : source;
  });
}

describe('buildAdminSourcePage', () => {
  it('ни одна страница не выходит за доказанный бюджет ответа', () => {
    const all = sourcesWithHealth();
    expect(all.length).toBeGreaterThan(20);

    let offset = 0;
    let pages = 0;
    const seen: string[] = [];
    for (;;) {
      const page = buildAdminSourcePage(all, offset);
      expect(JSON.stringify(page.items).length).toBeLessThanOrEqual(
        ADMIN_VACANCY_PAGE_BYTE_BUDGET,
      );
      seen.push(...page.items.map((item) => item.id));
      pages += 1;
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
      expect(pages).toBeLessThan(50);
    }

    // Страницы вместе отдают весь реестр и ровно по одному разу.
    expect(seen).toEqual(all.map((source) => source.id));
    expect(pages).toBeGreaterThan(1);
  });

  it('запись, которая одна не влезает в бюджет, всё равно уходит первой', () => {
    const huge = [
      { id: 'huge', name: 'x'.repeat(20_000) },
      { id: 'next', name: 'ещё один' },
    ];

    const page = buildAdminSourcePage(huge, 0);

    // Пустая страница выглядела бы концом выборки, и источник исчез бы совсем.
    expect(page.items.map((item) => item.id)).toEqual(['huge']);
    expect(page.nextOffset).toBe(1);
  });

  it('называет общее число, а не только размер страницы', () => {
    const all = sourcesWithHealth();
    const page = buildAdminSourcePage(all, 0);
    expect(page.total).toBe(all.length);
    expect(page.offset).toBe(0);
  });
});

describe('реестр площадок', () => {
  it('весь реестр целиком не влезает в один ответ — потому и страницы', () => {
    // Замер, а не предположение: если реестр когда-нибудь усохнёт до одного
    // ответа, страницы можно будет убрать, и этот тест об этом скажет.
    expect(JSON.stringify(sourcesWithHealth()).length).toBeGreaterThan(
      ADMIN_VACANCY_PAGE_BYTE_BUDGET,
    );
    expect(DEFAULT_VACANCY_SOURCES.length).toBeGreaterThan(20);
  });
});
