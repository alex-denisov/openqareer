import { describe, expect, it } from 'vitest';
import { isSkillRequirement, MIN_SKILL_REQUIREMENTS } from '../../domain/vacancyFit';
import { extractVacancyRequirements } from '../../domain/vacancyRequirements';
import { shownOwnRequirements } from './ownVacancyComparison';

const extracted = (text: string) =>
  extractVacancyRequirements({ vacancyId: 'own-1', description: text }).requirements;

/**
 * B676, прод 18.11: «4 из 4 есть в профиле», а в раскрытии две строки при пяти найденных.
 * Расчёт считал требования без подписей (`kind: 'other'` — навык), раскрытие показывало
 * подписанные, где длинное предложение без известного навыка — не навык.
 */
const TEXT = [
  'Требования:',
  '- SQL',
  '- Python',
  '- опыт построения процессов отчётности для руководства',
  '- умение договариваться с заказчиками внутри компании',
  '- английский язык B2',
].join('\n');

describe('требования своей вакансии: счёт и строки раскрытия — одни и те же (B676)', () => {
  it('каждое требование, которое считает расчёт, показано строкой раскрытия, и наоборот', () => {
    const raw = extracted(TEXT);
    expect(raw).toHaveLength(5);
    const counted = raw.filter(isSkillRequirement).map((item) => item.id);
    const shown = shownOwnRequirements(raw)
      .filter((item) => item.skill !== false)
      .map((item) => item.id);
    expect(counted.length).toBeGreaterThan(2);
    expect(shown).toEqual(counted);
  });

  it('строка «Требования: a; b, c; d» — отдельные требования, навыков хватает для счёта (прод 23.11)', () => {
    const raw = extracted(
      'Директор по разработке\nТребования: опыт руководства инженерными командами от 50 человек; ' +
        'построение платформы и процессов релиза; Kubernetes, PostgreSQL; английский B2.',
    );
    expect(raw.map((item) => item.text)).toEqual([
      'опыт руководства инженерными командами от 50 человек',
      'построение платформы и процессов релиза',
      'Kubernetes',
      'PostgreSQL',
      'английский B2',
    ]);
    expect(raw.filter(isSkillRequirement).length).toBeGreaterThanOrEqual(MIN_SKILL_REQUIREMENTS);
    expect(raw.find((item) => item.text === 'английский B2')?.kind).toBe('language');
  });

  it('строка без «;» и длинный перечень через запятую остаются одним требованием', () => {
    const raw = extracted('Требования:\n- опыт с Python, Go и Rust от 3 лет;\n- SQL');
    expect(raw.map((item) => item.text)).toEqual(['опыт с Python, Go и Rust от 3 лет;', 'SQL']);
  });

  it('у навыков остаётся короткая подпись для строки', () => {
    const labels = shownOwnRequirements(extracted(TEXT)).map((item) => item.label);
    expect(labels).toContain('SQL');
    expect(labels).toContain('Python');
  });
});
