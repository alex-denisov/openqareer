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

describe('B692: заголовок — фраза, как в макете a03: «роль · навыки через запятую»', () => {
  it('роль, до трёх навыков через запятую и Ex-работодатель только при явной дате окончания; без «|»', () => {
    const skills = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ id: `s${i}`, name }));
    const result = buildSectionSuggestions({ memory: [], draft: draft({ skills }) });
    expect(result.headline?.text).toBe('Head of Engineering · A, B, C · Ex-Яндекс');
    expect(result.headline?.facts.map((f) => f.id)).toEqual(['resume:targetRole', 'resume:skills', 'resume:experience:e1']);
    const noEnd = buildSectionSuggestions({ memory: [], draft: draft({ experience: [place({ endDate: undefined })] }) });
    expect(noEnd.headline?.text).toBe('Head of Engineering · Python, Go');
    const current = buildSectionSuggestions({ memory: [], draft: draft({ experience: [place({ current: true })] }) });
    expect(current.headline?.text).not.toContain('Ex-');
    expect(current.headline?.text).not.toContain('|');
  });
  it('целевой роли нет — роль из последнего места работы, а не список навыков (прод 22.11)', () => {
    const skills = ['Turn Around Management', 'Executive Leadership', 'n8n', 'Multi-agent Systems'].map((name, i) => ({ id: `s${i}`, name }));
    const result = buildSectionSuggestions({
      memory: [],
      draft: draft({ targetRole: '', skills, experience: [place({ title: 'VP of Technology & IT Operations', current: true })] }),
    });
    expect(result.headline?.text).toBe('VP of Technology & IT Operations · Turn Around Management, Executive Leadership, n8n');
    expect(result.headline?.facts.map((f) => f.id)).toEqual(['resume:experience:e1', 'resume:skills']);
  });
  it('длиннее 220 — отбрасываются хвостовые навыки, а не режется середина слова', () => {
    const role = 'R'.repeat(150);
    const skills = [{ id: 's1', name: 'S'.repeat(60) }, { id: 's2', name: 'T'.repeat(30) }];
    const text = buildSectionSuggestions({ memory: [], draft: draft({ targetRole: role, skills }) }).headline?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(220);
    expect(text.startsWith(role)).toBe(true);
    expect(text).not.toContain('T');
    const huge = buildSectionSuggestions({ memory: [], draft: draft({ targetRole: 'R'.repeat(400) }) }).headline?.text ?? '';
    expect(huge).toHaveLength(220);
  });
  it('без роли и без места работы — предложения нет: одни навыки — не заголовок', () => {
    expect(buildSectionSuggestions({ memory: [], draft: draft({ targetRole: '', skills: [] }) }).headline?.text).toBe('Руководитель разработки · Ex-Яндекс');
    expect(buildSectionSuggestions({ memory: [], draft: draft({ targetRole: '', experience: [] }) }).headline).toBeNull();
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

describe('B645: «О себе» и «Опыт»', () => {
  it('склейкой фактов не строятся — их пишет модель пересказом', () => {
    const memory = [mem('d1', 'Отвечал за найм'), mem('b1', 'Запустил платформу для 12 команд')];
    const result = buildSectionSuggestions({ memory, draft: draft({ experience: [place({ descriptionMemoryId: 'd1', bulletMemoryIds: ['b1'] })] }) });
    expect(result.about).toBeNull();
    expect(result.experience).toBeNull();
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
