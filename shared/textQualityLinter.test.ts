import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RU_SLOP_REGISTRY, lintTextQuality } from './textQualityLinter';

/**
 * Реестр штампов живёт в навыке `anti-slop-humanizer`, а проверяет его код.
 * Разойдись они — навык учил бы одному, а тест ловил другое (B210).
 */
describe('lintTextQuality', () => {
  it('называет штамп и место, где он стоит', () => {
    const findings = lintTextQuality('В современном мире это уникальный инструмент.');
    expect(findings.map((f) => f.phrase)).toEqual(
      expect.arrayContaining(['в современном мире', 'уникальный']),
    );
    expect(findings[0].index).toBeGreaterThanOrEqual(0);
  });

  it('ловит обороты-склейки и назидательный финал', () => {
    const findings = lintTextQuality('Наша миссия — помочь вам. Важно отметить: главное — начать.');
    expect(findings.map((f) => f.phrase)).toEqual(
      expect.arrayContaining(['наша миссия', 'важно отметить']),
    );
  });

  it('не придирается к тексту, который называет факты', () => {
    expect(
      lintTextQuality('Совпало 12 из 52 требований вакансии. Название совпадает с целевой ролью.'),
    ).toEqual([]);
  });

  it('часть слова штампом не считается', () => {
    // «Синергия» — штамп, «синергетический эффект мышц» в тексте о спорте нет,
    // но проверка обязана смотреть на границы слова, а не на подстроку.
    expect(lintTextQuality('Экосистемные услуги леса измеряются в гектарах.')).toEqual([]);
  });

  it('пустой и пробельный текст замечаний не даёт', () => {
    expect(lintTextQuality('')).toEqual([]);
    expect(lintTextQuality('   \n  ')).toEqual([]);
  });
});

describe('реестр штампов не расходится с навыком', () => {
  it('каждое слово реестра названо в SKILL.md', () => {
    // Навык — текст с переносами: «ключевой\nдрайвер» и «ключевой драйвер» —
    // одно и то же слово реестра, и сверка не должна спотыкаться о вёрстку.
    const skill = readFileSync('.agents/skills/anti-slop-humanizer/SKILL.md', 'utf8')
      .toLowerCase()
      .replace(/\s+/gu, ' ');
    const missing = RU_SLOP_REGISTRY.filter((phrase) => !skill.includes(phrase));
    expect(missing).toEqual([]);
  });
});
