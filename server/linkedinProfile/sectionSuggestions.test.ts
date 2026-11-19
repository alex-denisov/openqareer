import { describe, expect, it } from 'vitest';
import { buildSectionSuggestions, numbersAreGrounded } from './sectionSuggestions';

const mem = (id: string, statement: string, status = 'confirmed', domain = 'outcome') => ({ id, statement, status, domain, sensitive: false });
const place = (over: Record<string, unknown> = {}) => ({
  id: 'e1', chronologyMemoryId: 'c1', title: 'Руководитель разработки', employer: 'Яндекс', startDate: '2019', endDate: '2022',
  current: false, bulletMemoryIds: [] as string[], ...over,
});
const draft = (over: Record<string, unknown> = {}) => ({
  targetRole: 'Head of Engineering', experience: [place()], skills: [{ id: 's1', name: 'Python' }, { id: 's2', name: 'Go' }], ...over,
}) as never;

describe('B692: заголовок', () => {
  it('роль, до четырёх навыков и Ex-работодатель только при явной дате окончания', () => {
    const skills = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ id: `s${i}`, name }));
    const result = buildSectionSuggestions({ memory: [], draft: draft({ skills }) });
    expect(result.headline?.text).toBe('Head of Engineering | A | B | C | D | Ex-Яндекс');
    expect(result.headline?.facts.map((f) => f.id)).toEqual(['resume:targetRole', 'resume:skills', 'resume:experience:e1']);
    const noEnd = buildSectionSuggestions({ memory: [], draft: draft({ experience: [place({ endDate: undefined })] }) });
    expect(noEnd.headline?.text).not.toContain('Ex-');
    const current = buildSectionSuggestions({ memory: [], draft: draft({ experience: [place({ current: true })] }) });
    expect(current.headline?.text).not.toContain('Ex-');
  });
  it('длиннее 220 — отбрасываются хвостовые части, а не режется середина слова', () => {
    const role = 'R'.repeat(150);
    const skills = [{ id: 's1', name: 'S'.repeat(60) }, { id: 's2', name: 'T'.repeat(30) }];
    const text = buildSectionSuggestions({ memory: [], draft: draft({ targetRole: role, skills }) }).headline?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(220);
    expect(text.startsWith(role)).toBe(true);
    expect(text).not.toContain('T');
    const huge = buildSectionSuggestions({ memory: [], draft: draft({ targetRole: 'R'.repeat(400) }) }).headline?.text ?? '';
    expect(huge).toHaveLength(220);
  });
  it('без роли и навыков предложения нет', () => {
    expect(buildSectionSuggestions({ memory: [], draft: draft({ targetRole: '', skills: [] }) }).headline).toBeNull();
    expect(buildSectionSuggestions({ memory: [], draft: null }).headline).toBeNull();
  });
});

describe('B692: навыки', () => {
  it('навык с неподтверждённым основанием в память не попадает, повторы убираются', () => {
    const skills = [
      { id: 's1', name: 'Python' }, { id: 's2', name: 'python' },
      { id: 's3', name: 'Rust', evidenceMemoryId: 'm-proposed' }, { id: 's4', name: 'Go', evidenceMemoryId: 'm-ok' },
    ];
    const result = buildSectionSuggestions({
      memory: [mem('m-proposed', 'x', 'proposed'), mem('m-ok', 'y')], draft: draft({ skills }),
    });
    expect(result.skills?.text).toBe('Python · Go');
    expect(result.skills?.facts.map((f) => f.text)).toEqual(['Python', 'Go']);
  });
});

describe('B692: «О себе» и опыт', () => {
  it('только подтверждённые факты; предложенные, чувствительные и пробелы отбрасываются', () => {
    const memory = [
      mem('m1', 'Вёл команду из 9 человек'), mem('m2', 'Сократил релиз до 3 дней', 'corrected'),
      mem('m3', 'Увеличил выручку в 5 раз', 'proposed'), { ...mem('m4', 'Болел 2 года'), sensitive: true },
      mem('m5', 'Нет опыта в Rust', 'confirmed', 'gap'),
    ];
    const about = buildSectionSuggestions({ memory, draft: draft() }).about;
    expect(about?.text).toBe('Head of Engineering. Вёл команду из 9 человек. Сократил релиз до 3 дней.');
    expect(about?.facts.map((f) => f.id)).toEqual(['resume:targetRole', 'm1', 'm2']);
    expect(about?.text).not.toMatch(/5 раз|Болел|Rust/u);
    expect(numbersAreGrounded(about?.text ?? '', about?.facts ?? [])).toBe(true);
  });
  it('нет подтверждённых фактов — предложения нет', () => {
    const memory = [mem('m3', 'Увеличил выручку в 5 раз', 'proposed')];
    const result = buildSectionSuggestions({ memory, draft: draft() });
    expect(result.about).toBeNull();
    expect(result.experience).toBeNull();
  });
  it('опыт: места с подтверждённым описанием; без подтверждённого — места нет в тексте', () => {
    const memory = [mem('b1', 'Запустил платформу для 12 команд'), mem('b2', 'Снизил расходы на 40 %', 'proposed'), mem('d1', 'Отвечал за найм')];
    const experience = [
      place({ bulletMemoryIds: ['b1', 'b2'], descriptionMemoryId: 'd1' }),
      place({ id: 'e2', title: 'Разработчик', employer: 'Ozon', bulletMemoryIds: ['b2'] }),
    ];
    const result = buildSectionSuggestions({ memory, draft: draft({ experience }) }).experience;
    expect(result?.items).toEqual([
      {
        id: 'e1',
        label: 'Яндекс · Руководитель разработки',
        text: 'Отвечал за найм. Запустил платформу для 12 команд.',
        facts: [
          { id: 'resume:experience:e1', text: 'Руководитель разработки — Яндекс (2019 — 2022)' },
          { id: 'd1', text: 'Отвечал за найм' },
          { id: 'b1', text: 'Запустил платформу для 12 команд' },
        ],
      },
    ]);
    expect(result?.text).toBe('Яндекс · Руководитель разработки\nОтвечал за найм. Запустил платформу для 12 команд.');
    expect(result?.text).not.toMatch(/Ozon|40/u);
    expect(result?.facts.map((f) => f.id)).toEqual(['resume:experience:e1', 'd1', 'b1']);
  });
  it('B645: опыт по местам работы — у каждого места своё короткое предложение, не больше трёх фраз', () => {
    const memory = ['d1', 'b1', 'b2', 'b3', 'd2'].map((id) => mem(id, `Факт ${id}`));
    const experience = [
      place({ descriptionMemoryId: 'd1', bulletMemoryIds: ['b1', 'b2', 'b3'] }),
      place({ id: 'e2', title: 'Разработчик', employer: 'Ozon', descriptionMemoryId: 'd2' }),
    ];
    const result = buildSectionSuggestions({ memory, draft: draft({ experience }) }).experience;
    expect(result?.items?.map((item) => [item.label, item.text])).toEqual([
      ['Яндекс · Руководитель разработки', 'Факт d1. Факт b1. Факт b2.'],
      ['Ozon · Разработчик', 'Факт d2.'],
    ]);
    expect(result?.items?.[0]?.facts.map((f) => f.id)).toEqual(['resume:experience:e1', 'd1', 'b1', 'b2']);
    expect(result?.text.split('\n\n')).toHaveLength(2);
  });
});

describe('B692: проверка чисел', () => {
  it('число, которого нет в фактах, не проходит', () => {
    const facts = [{ id: 'm1', text: 'Вёл команду из 9 человек' }];
    expect(numbersAreGrounded('Вёл 9 человек', facts)).toBe(true);
    expect(numbersAreGrounded('Вёл 12 человек', facts)).toBe(false);
    expect(numbersAreGrounded('Рост 2,5 раза', [{ id: 'x', text: 'рост 2.5 раза' }])).toBe(true);
  });
});
