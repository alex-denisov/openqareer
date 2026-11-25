import { describe, expect, it } from 'vitest';
import { INTERVIEW_ASK_MAX_CHARS } from '../../shared/interviewAsks';
import { interviewVacancyAsks } from './interviewVacancyAsks';
import { extractVacancyRequirements } from './vacancyRequirements';

const SNOWFLAKE =
  'Snowflake is about empowering enterprises to achieve their full potential with data. You will lead the team that builds AI functions inside SQL pipelines. You will hire and grow engineering managers across two sites. We are proud of our equal opportunity culture.';
const ENERGY =
  'Обязанности:\n- Эксплуатация солнечных электростанций и распредустройств 35 кВ\n- Разработка графиков планового ремонта\nТребования:\n- Опыт эксплуатации электроустановок от 3 лет\n- Группа по электробезопасности V\nУсловия:\n- ДМС и оклад от 150 000 ₽';

const texts = (description: string) => interviewVacancyAsks(description).map((ask) => ask.text);

describe('interviewVacancyAsks (B635)', () => {
  it('у разных описаний — разные вопросы, словами описания', () => {
    const snowflake = texts(SNOWFLAKE).join('\n');
    const energy = texts(ENERGY).join('\n');
    expect(snowflake).toContain('AI functions inside SQL pipelines');
    expect(snowflake).not.toContain('equal opportunity');
    expect(energy).toContain('Эксплуатация солнечных электростанций');
    expect(energy).toContain('Опыт эксплуатации электроустановок');
    expect(energy).not.toMatch(/ДМС|оклад/u);
  });

  it('строка описания не повторяет названную задачу, текст не длиннее id', () => {
    const asks = texts(`${ENERGY}\n- ${'Очень длинная строка '.repeat(15)}`);
    expect(new Set(asks).size).toBe(asks.length);
    expect(asks.every((text) => text.length <= INTERVIEW_ASK_MAX_CHARS)).toBe(true);
  });

  it('извлечённые требования берутся первыми; выведенные моделью и условия — нет', () => {
    const [base] = extractVacancyRequirements({
      vacancyId: 'v',
      description: 'Требования:\nKafka под нагрузкой',
    }).requirements;
    const asks = interviewVacancyAsks(SNOWFLAKE, [
      { ...base!, id: 'a' },
      { ...base!, id: 'b', text: 'Догадка модели', origin: 'inferred' },
      { ...base!, id: 'c', text: 'Office in Berlin', kind: 'workFormat' },
    ]);
    expect(asks[0]).toEqual({ kind: 'req', text: 'Kafka под нагрузкой' });
    expect(JSON.stringify(asks)).not.toMatch(/Догадка|Berlin/u);
  });

  it('рассказ компании о себе и призыв — не вопросы', () => {
    const asks = texts(
      "At Snowflake, your role isn't just to execute a function, but to help redefine the future of how work gets done. You will hire and mentor senior technical leaders. Join us at the forefront of AI innovation where you'll lead transformative initiatives. You don’t just use tools; you will treat AI as a high-trust collaborator in your role.",
    ).join('\n');
    expect(asks).toContain('mentor senior technical leaders');
    expect(asks).not.toMatch(/At Snowflake|Join us|just use tools/u);
  });

  it.each([
    'At least 5 years of experience with Kafka',
    'At minimum, a BS degree in Computer Science',
    'We look for 5+ years of Go experience',
  ])('требование с тем же началом остаётся: %s', (line) => {
    expect(texts(`Snowflake builds a data platform for everyone. ${line}.`).join('\n')).toContain(
      line,
    );
  });

  it('часть уже названного требования не повторяется', () => {
    const base = extractVacancyRequirements({
      vacancyId: 'v',
      description: 'Требования:\nKafka под нагрузкой',
    }).requirements[0]!;
    const asks = interviewVacancyAsks(SNOWFLAKE, [
      { ...base, id: 'a', text: 'Пишет на Go 7 лет, более 3 лет управляет командой' },
      { ...base, id: 'b', text: 'более 3 лет управляет командой' },
    ]);
    expect(asks.filter(({ text }) => text.includes('управляет командой'))).toHaveLength(1);
  });

  it('«Предстоит» и «Ключевые цели» — задачи роли, а не требования', () => {
    for (const heading of ['Предстоит:', 'Ключевые цели:']) {
      const quote = 'Управление командой системных администраторов';
      const need = 'Опыт эксплуатации серверов от 5 лет';
      const description = `${heading}\n\n- ${quote}\n\nМы ожидаем:\n\n- ${need}`;
      const base = extractVacancyRequirements({
        vacancyId: 'v',
        description: `Требования:\n- ${need}`,
      }).requirements[0]!;
      const asks = interviewVacancyAsks(description, [
        { ...base, id: 'a', text: quote, sourceQuote: quote },
        { ...base, id: 'b', text: need, sourceQuote: need },
      ]);
      expect(asks).toContainEqual({ kind: 'duty', text: quote });
      expect(asks).toContainEqual({ kind: 'req', text: need });
    }
  });

  it('описания нет — вопросов по нему нет', () => {
    expect(interviewVacancyAsks('  ')).toEqual([]);
  });
});
