import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseResumeContent } from './resumeParser';
import { normalizeResumeSourceText } from './resumeSourceText';

/**
 * Настоящая выгрузка профиля LinkedIn владельца — та самая, что кладётся в
 * профиль `candidate.test`. Рядом лежит исходный PDF
 * (`fixtures/linkedin-owner-profile.pdf`); владелец разрешил держать свои
 * данные в репозитории 2026-09-01, потому что разбор его резюме и есть
 * проверяемый результат (B179).
 *
 * Проверяется детерминированный разбор — тот, что работает без модели. Он и
 * есть пол: провайдер может молчать, а профиль всё равно обязан собраться.
 */
const parsed = parseResumeContent(
  normalizeResumeSourceText(
    readFileSync(new URL('./fixtures/linkedin-owner-profile.txt', import.meta.url), 'utf8'),
  ),
);

describe('разбор выгрузки LinkedIn без модели', () => {
  it('читает имя, контакты и город из шапки', () => {
    expect(parsed.fullName).toBe('Alexey Denisov');
    expect(parsed.contact?.email).toBe('alexey.denisov@me.com');
    expect(parsed.contact?.location).toBe('Dubai');
    expect(parsed.contact?.links).toContain('https://www.linkedin.com/in/alexeydenisov');
  });

  it('берёт заголовок профиля целевой ролью и не тащит обрывок разделителя', () => {
    expect(parsed.targetRole).toBe('VP of Technology & Operations');
  });

  it('находит все шесть мест работы с должностью, работодателем и периодом', () => {
    expect(parsed.experience).toHaveLength(6);

    const vp = parsed.experience.find((entry) => entry.employer === 'Enterprise Energy IT Services');
    expect(vp?.title).toBe('VP of Technology & IT Operations');
    expect(vp?.startDate).toBe('2023-04');
    expect(vp?.endDate).toBe('2025-10');
    expect(vp?.current).toBe(false);
  });

  it('текущее место отмечено текущим и без выдуманной даты конца', () => {
    const current = parsed.experience.filter((entry) => entry.current);

    expect(current).toHaveLength(1);
    expect(current[0].employer).toBe('OptiLab AI');
    expect(current[0].endDate).toBeUndefined();
  });

  it('у каждого места есть пункты — именно их печатает «Главная»', () => {
    for (const entry of parsed.experience) {
      expect(
        entry.responsibilities.length + entry.achievements.length,
        `пункты места ${entry.employer}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('читает образование, навыки и языки', () => {
    expect(parsed.education.map((entry) => entry.institution)).toEqual([
      'Geekbrains',
      'Universitatea Tehnică a Moldovei',
    ]);
    // LinkedIn печатает ровно три «Top Skills» — больше в выгрузке нет.
    expect(parsed.skills).toEqual(['Turn Around Management', 'Executive Leadership', 'n8n']);
    expect(parsed.languages.map((language) => language.name)).toEqual(['Russian', 'English']);
  });

  it('«о себе» доезжает целиком, а не первой строкой', () => {
    expect(parsed.about?.length).toBeGreaterThan(1_000);
    expect(parsed.about).toContain('transform technology organizations');
  });
});
