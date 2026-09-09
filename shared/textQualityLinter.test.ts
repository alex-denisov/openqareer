import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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

const SKILL_PATH = '.agents/skills/anti-slop-humanizer/SKILL.md';

/**
 * Навык лежит в `.agents/`, а этот каталог намеренно вне git: репозиторий —
 * только приложение (PRB-009). Поэтому в CI файла навыка нет, и сверка идёт
 * там, где он есть. Молча она не исчезает: пропуск виден в отчёте прогона.
 */
describe('реестр штампов не расходится с навыком', () => {
  it('реестр не пуст и не содержит повторов', () => {
    expect(RU_SLOP_REGISTRY.length).toBeGreaterThan(10);
    expect(new Set(RU_SLOP_REGISTRY).size).toBe(RU_SLOP_REGISTRY.length);
    // Пустая строка нашлась бы в любом тексте и сделала бы проверку шумом.
    expect(RU_SLOP_REGISTRY.every((phrase) => phrase.trim() === phrase && phrase.length > 2)).toBe(
      true,
    );
  });

  it.runIf(existsSync(SKILL_PATH))('каждое слово реестра названо в SKILL.md', () => {
    // Навык — текст с переносами: «ключевой\nдрайвер» и «ключевой драйвер» —
    // одно и то же слово реестра, и сверка не должна спотыкаться о вёрстку.
    const skill = readFileSync(SKILL_PATH, 'utf8')
      .toLowerCase()
      .replace(/\s+/gu, ' ');
    const missing = RU_SLOP_REGISTRY.filter((phrase) => !skill.includes(phrase));
    expect(missing).toEqual([]);
  });
});
