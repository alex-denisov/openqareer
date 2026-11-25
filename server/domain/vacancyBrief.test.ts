import { describe, expect, it } from 'vitest';
import { vacancyBrief } from './vacancyBrief';

describe('краткое содержание вакансии (B791)', () => {
  it('разделы с маркерами: пункты её же словами, подзаголовок и условия не попадают', () => {
    const brief = vacancyBrief(
      'О компании\nПлатёжный сервис.\nОбязанности:\nУправление\n- Вести команду;\n- Планировать бюджет.\nТребования:\n- Опыт от 5 лет\n- Go, PostgreSQL\nУсловия:\n- ДМС',
    );
    expect(brief?.duties).toEqual(['Вести команду', 'Планировать бюджет']);
    expect(brief?.requirements).toEqual(['Опыт от 5 лет', 'Go, PostgreSQL']);
  });

  it('HTML и заголовок, где раздел назван внутри строки', () => {
    const brief = vacancyBrief(
      '<p><strong>Role And Responsibilities</strong></p><ul><li>Lead the platform team.</li></ul><p>Show us what you have (aka requirements)</p><ul><li>10+ years in engineering</li></ul>',
    );
    expect(brief?.duties).toEqual(['Lead the platform team']);
    expect(brief?.requirements).toEqual(['10+ years in engineering']);
  });

  it('всё одной строкой: «Обязанности: …; … Требования: …»', () => {
    const brief = vacancyBrief(
      'Ищем руководителя. Обязанности: вести команду; нанимать людей. Требования: опыт от 5 лет; Go.',
    );
    expect(brief?.duties).toEqual(['вести команду', 'нанимать людей']);
    expect(brief?.requirements).toEqual(['опыт от 5 лет', 'Go']);
  });

  it('разделов нет — первые предложения целиком', () => {
    const text = 'Развиваем платёжную платформу для малого бизнеса. '.repeat(10);
    const brief = vacancyBrief(text);
    expect(brief?.duties).toEqual([]);
    expect(brief!.opening.length).toBeLessThanOrEqual(280);
    expect(brief!.opening.endsWith('.')).toBe(true);
    expect(text.startsWith(brief!.opening)).toBe(true);
  });

  it('пусто и строка «Должность — Компания — Город» — нет содержания', () => {
    expect(vacancyBrief('')).toBeUndefined();
    expect(
      vacancyBrief('Head of Operations — Eden Rose — Abu Dhabi, United Arab Emirates'),
    ).toBeUndefined();
  });
});
