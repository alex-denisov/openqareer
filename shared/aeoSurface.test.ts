import { describe, expect, it } from 'vitest';
import { buildLlmsTxt, buildLlmsFullTxt, AEO_PUBLISHED_PATHS } from './aeoSurface';
import { isValidPublicPath } from './seoSlugPolicy';
import { LEGAL_DOCS, legalPath } from './legalRegistry';

const GUARANTEE = /гарантир\w*\s+(работ|оффер|интервью|трудоустрой)/iu;
const UNVERIFIABLE = /(революционн|уникальн\w*\s+в\s+мире|лучш\w+\s+в\s+(мире|россии)|№\s?1)/iu;

describe('витрина для ИИ-поисковиков (B209)', () => {
  it('llms.txt начинается с имени продукта и называет канонический адрес', () => {
    const text = buildLlmsTxt();
    expect(text.startsWith('# openqareer\n')).toBe(true);
    expect(text).toContain('https://openqareer.com');
  });

  it('llms-full.txt содержит всё, что названо в коротком llms.txt', () => {
    const short = buildLlmsTxt();
    const full = buildLlmsFullTxt();
    for (const path of AEO_PUBLISHED_PATHS) {
      expect(short.includes(path) || full.includes(path)).toBe(true);
      expect(full).toContain(path);
    }
    expect(full.length).toBeGreaterThan(short.length);
  });

  it('называет каждый опубликованный правовой документ', () => {
    const full = buildLlmsFullTxt();
    for (const doc of LEGAL_DOCS) {
      expect(full).toContain(legalPath(doc.slug));
    }
  });

  it('каждый внутренний адрес витрины отвечает политике адресов', () => {
    for (const path of AEO_PUBLISHED_PATHS) {
      expect(isValidPublicPath(path)).toBe(true);
    }
  });

  it('не обещает работу, оффер или интервью', () => {
    expect(buildLlmsTxt()).not.toMatch(GUARANTEE);
    expect(buildLlmsFullTxt()).not.toMatch(GUARANTEE);
  });

  it('не содержит непроверяемых превосходных степеней', () => {
    expect(buildLlmsFullTxt()).not.toMatch(UNVERIFIABLE);
  });

  /**
   * Витрина обещает перечислить адреса продукта. Публичный каталог вакансий
   * (B209, срез 2a) — самая большая его часть, и умолчать о ней значит скрыть
   * от ИИ-ответчика ровно то, ради чего он приходит.
   */
  it('называет публичный каталог вакансий', () => {
    expect(AEO_PUBLISHED_PATHS).toContain('/vacancies');
    expect(buildLlmsTxt()).toContain('/vacancies');
    expect(buildLlmsFullTxt()).toContain('/vacancies');
  });

  it('называет границы продукта, а не только возможности', () => {
    const full = buildLlmsFullTxt();
    expect(full).toContain('Чего продукт не делает');
  });
});


describe('B545: dated pool evidence', () => {
  const stats = { activeCount: 123, remoteCount: 45, sourceCount: 6, updatedAt: '2026-10-23', vacancies: [] };
  it('both surfaces name the observation date, source and duplicate boundary', () => {
    for (const build of [buildLlmsTxt, buildLlmsFullTxt]) {
      const text = build(stats);
      expect(text).toContain('2026-10-23');
      expect(text).toContain('123');
      expect(text).toContain('45');
      expect(text).toContain('6');
      expect(text).toContain('vacancy_pool_index');
      expect(text).toContain('могут повторяться');
    }
  });
  it('does not invent a current reading when no snapshot was supplied', () => {
    expect(buildLlmsTxt()).not.toContain('## Срез пула');
    expect(buildLlmsFullTxt()).not.toContain('## Срез пула');
  });
});
