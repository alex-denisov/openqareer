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

  it('описания нет — вопросов по нему нет', () => {
    expect(interviewVacancyAsks('  ')).toEqual([]);
  });
});
