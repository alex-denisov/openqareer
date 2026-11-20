import { describe, expect, it } from 'vitest';
import { extractVacancyRequirements } from '../../domain/vacancyRequirements';
import { ownVacancyFromText, structureVacancyText } from './ownVacancyText';

const FLAT =
  'Руководитель отдела аналитики — Компания: Альфа Девелопмент. Город: Москва. Гибридный формат, 2 дня в офисе. ' +
  'Обязанности: строить отчётность; вести команду из 5 аналитиков. ' +
  'Требования: опыт в аналитике от 5 лет; SQL; Python; опыт управления командой; английский B2. ' +
  'Мы предлагаем: ДМС; гибкий график.';

describe('своя вакансия из вставленного текста (B676)', () => {
  it('текст одной строкой разбивается на строки, требования находятся', () => {
    const structured = structureVacancyText(FLAT);
    expect(structured.split('\n').length).toBeGreaterThan(6);
    const { requirements } = extractVacancyRequirements({
      vacancyId: 'own-1',
      description: structured,
    });
    expect(requirements.map((item) => item.text)).toEqual([
      'опыт в аналитике от 5 лет',
      'SQL',
      'Python',
      'опыт управления командой',
      'английский B2.',
    ]);
  });

  it('название — первая фраза, а не первые 160 знаков', () => {
    expect(ownVacancyFromText(FLAT).title).toBe('Руководитель отдела аналитики');
  });

  it('компания, город и формат берутся из текста', () => {
    expect(ownVacancyFromText(FLAT)).toMatchObject({
      company: 'Альфа Девелопмент',
      location: 'Москва',
      workFormat: 'hybrid',
      url: null,
    });
  });

  it('текст по строкам не меняется, поля из строк «Компания:» и «Локация:»', () => {
    const text =
      'Data Engineer\nCompany: Beta Labs\nLocation: Berlin, Germany\nRemote\n\nRequirements:\n- Spark\n- Airflow';
    expect(structureVacancyText(text)).toBe(text);
    expect(ownVacancyFromText(text)).toMatchObject({
      title: 'Data Engineer',
      company: 'Beta Labs',
      location: 'Berlin, Germany',
      workFormat: 'remote',
    });
  });

  it('без полей в тексте — пусто, а не выдумка', () => {
    const text = 'Ищем инженера. Требования: опыт с Kubernetes от 2 лет; Terraform.';
    expect(ownVacancyFromText(text)).toMatchObject({
      title: 'Ищем инженера',
      company: null,
      location: null,
      workFormat: null,
    });
  });

  it('длинная первая фраза обрезается по слову', () => {
    const title = ownVacancyFromText(
      `${'Очень длинное название вакансии '.repeat(10)}. Требования: SQL.`,
    ).title;
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.endsWith(' ')).toBe(false);
    expect(title).toMatch(/вакансии$|название$|длинное$|Очень$/u);
  });

  it('длинные серии пробелов и точек разбираются за линейное время', () => {
    const hostile = `Инженер ${' '.repeat(15_000)}x${'.'.repeat(15_000)}y Требования: SQL; ${' \t'.repeat(5_000)}Python`;
    const startedAt = performance.now();
    const parsed = ownVacancyFromText(hostile);
    expect(performance.now() - startedAt).toBeLessThan(200);
    expect(parsed.text).not.toMatch(/ {2}/u);
  });
});
