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

  it('называет границы продукта, а не только возможности', () => {
    const full = buildLlmsFullTxt();
    expect(full).toContain('Чего продукт не делает');
  });
});
