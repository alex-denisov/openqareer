import { describe, expect, it } from 'vitest';
import { acceptAdaptationSteps, expectationLines } from './adaptationSteps';

const LINES = ['Руководить командой из 25 человек', 'Снизить число инцидентов', 'Перевести поставку на еженедельный релиз'];
const step = (line: number, title: string, stage = 'days_1_30') => ({ line, title, description: 'Описание', stage, category: 'delivery' });

describe('expectationLines', () => {
  it('splits the field into duty lines without bullets, repeats and empties, at most eight', () => {
    expect(expectationLines('• Руководить командой\n\n- Снизить инциденты\n— Руководить командой')).toEqual([
      'Руководить командой',
      'Снизить инциденты',
    ]);
    const many = Array.from({ length: 12 }, (_, index) => `Обязанность ${index}`).join('\n');
    expect(expectationLines(many)).toHaveLength(8);
    expect(expectationLines('1. Выстроить поставку\n2) 3 релиза в месяц')).toEqual(['Выстроить поставку', '3 релиза в месяц']);
    expect(expectationLines(null)).toEqual([]);
    expect(expectationLines('   ')).toEqual([]);
  });
});

describe('acceptAdaptationSteps', () => {
  it('keeps steps that reference an existing line and returns that line', () => {
    const steps = acceptAdaptationSteps(
      { steps: [step(1, 'Познакомиться с командой'), step(2, 'Разобрать инциденты', 'days_31_60'), step(3, 'Запустить еженедельный релиз', 'days_61_90')] },
      LINES,
    );
    expect(steps?.map((item) => [item.title, item.stage, item.basis])).toEqual([
      ['Познакомиться с командой', 'days_1_30', LINES[0]],
      ['Разобрать инциденты', 'days_31_60', LINES[1]],
      ['Запустить еженедельный релиз', 'days_61_90', LINES[2]],
    ]);
  });

  it('drops steps with an unknown line, a bad stage or a repeated title', () => {
    const steps = acceptAdaptationSteps(
      {
        steps: [
          step(1, 'Познакомиться с командой'),
          step(9, 'Выдуманная строка'),
          step(0, 'Нулевая строка'),
          step(2, 'Плохой этап', 'prep'),
          step(2, 'познакомиться с командой '),
          step(2, 'Разобрать инциденты'),
          step(3, 'Запустить релиз'),
        ],
      },
      LINES,
    );
    expect(steps?.map((item) => item.title)).toEqual(['Познакомиться с командой', 'Разобрать инциденты', 'Запустить релиз']);
  });

  it('gives null when fewer than three steps survive or the answer has no steps', () => {
    expect(acceptAdaptationSteps({ steps: [step(1, 'Один'), step(2, 'Два'), step(7, 'Три')] }, LINES)).toBeNull();
    expect(acceptAdaptationSteps({ text: 'нет' }, LINES)).toBeNull();
    expect(acceptAdaptationSteps('строка', LINES)).toBeNull();
  });

  it('keeps at most twelve steps and trims long text', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ ...step(1, `Шаг ${index}`), description: 'д'.repeat(1500) }));
    const steps = acceptAdaptationSteps({ steps: many }, LINES);
    expect(steps).toHaveLength(12);
    expect(steps?.[0].description.length).toBeLessThanOrEqual(1000);
  });
});
