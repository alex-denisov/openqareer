import { describe, expect, it } from 'vitest';
import { checkLinkedinVariant, linkedinVariantRequest } from './linkedinVariant';

const mem = (id: string, statement: string, status = 'confirmed') => ({ id, statement, status, domain: 'outcome', sensitive: false });
const INPUT = {
  memory: [
    mem('d1', 'Руководил группой из 9 разработчиков платёжной платформы'),
    mem('b1', 'Сократил цикл релиза с 2 недель до 3 дней'),
    mem('x1', 'Увеличил выручку в 5 раз', 'proposed'),
  ],
  draft: {
    targetRole: 'Руководитель разработки',
    experience: [{ id: 'e1', chronologyMemoryId: 'c1', employer: 'Финтех Лаб', title: 'Тимлид', current: true, bulletMemoryIds: ['d1', 'b1', 'x1'] }],
    skills: [{ id: 's1', name: 'Go' }, { id: 's2', name: 'Kubernetes' }, { id: 's3', name: 'PostgreSQL' }],
  },
} as never;

describe('B645 a03: «Предложить заново» — вход модели', () => {
  it('у места работы — только его подтверждённые факты и прежние тексты', () => {
    const request = linkedinVariantRequest('experience:e1', INPUT, ['Прежний вариант']);
    expect(request).toMatchObject({ target: 'place', label: 'Финтех Лаб · Тимлид', avoid: ['Прежний вариант'], language: 'ru' });
    expect(request?.facts.map((fact) => fact.id)).toEqual(['d1', 'b1']);
  });

  it('заголовок — роль, навыки и места; навыки — список кандидата; чужого ключа нет', () => {
    expect(linkedinVariantRequest('headline', INPUT, [])?.facts.map((fact) => fact.id)).toEqual([
      'resume:targetRole', 'resume:skill:s1', 'resume:skill:s2', 'resume:skill:s3', 'resume:experience:e1',
    ]);
    expect(linkedinVariantRequest('skills', INPUT, [])?.facts.map((fact) => fact.text)).toEqual(['Go', 'Kubernetes', 'PostgreSQL']);
    expect(linkedinVariantRequest('experience:nope', INPUT, [])).toBeNull();
  });
});

describe('B645 a03: «Предложить заново» — проверка ответа', () => {
  const place = linkedinVariantRequest('experience:e1', INPUT, ['Ведёт команду из 9 разработчиков.'])!;

  it('пересказ на своих фактах принимается', () => {
    const text = 'Вывел платёжную команду на релиз каждые 3 дня вместо 2 недель. Отвечает за группу из 9 разработчиков.';
    expect(checkLinkedinVariant(place, { text, factIds: ['d1', 'b1'] })).toBe(text);
  });

  it('повтор прежнего варианта, чужое число, первое лицо и копия факта — отказ', () => {
    expect(checkLinkedinVariant(place, { text: 'Ведёт команду из 9 разработчиков.', factIds: ['d1'] })).toBeNull();
    expect(checkLinkedinVariant(place, { text: 'Вырастил выручку в 5 раз.', factIds: ['b1'] })).toBeNull();
    expect(checkLinkedinVariant(place, { text: 'Я руководил группой из 9 человек.', factIds: ['d1'] })).toBeNull();
    expect(checkLinkedinVariant(place, { text: 'Сократил цикл релиза с 2 недель до 3 дней.', factIds: ['b1'] })).toBeNull();
    expect(checkLinkedinVariant(place, { text: 'Отвечает за выпуск каждые 3 дня.', factIds: ['x1'] })).toBeNull();
  });

  it('заголовок называет роль и длинные навыки как есть (прод 24.11: 503 четыре раза из четырёх)', () => {
    const input = { memory: [], draft: {
      targetRole: 'Операционный директор', experience: [],
      skills: [{ id: 's1', name: 'Автоматизация бизнес-процессов' }, { id: 's2', name: 'Управление операционной деятельностью' }],
    } } as never;
    const request = linkedinVariantRequest('headline', input, ['Операционный директор'])!;
    const text = 'Операционный директор | Управление операционной деятельностью · Автоматизация бизнес-процессов';
    expect(checkLinkedinVariant(request, { text, factIds: ['resume:targetRole', 'resume:skill:s1', 'resume:skill:s2'] })).toBe(text);
  });

  it('отказ называет код причины', () => {
    const reasons: string[] = [];
    checkLinkedinVariant(place, { text: 'Вырастил выручку в 5 раз.', factIds: ['b1'] }, (reason) => reasons.push(reason));
    checkLinkedinVariant(place, { text: 'Ведёт команду из 9 разработчиков.', factIds: ['d1'] }, (reason) => reasons.push(reason));
    expect(reasons).toEqual(['ungrounded_number', 'repeat']);
  });

  it('навыки — только из списка кандидата, через «·», без повторов', () => {
    const skills = linkedinVariantRequest('skills', INPUT, ['Go · Kubernetes · PostgreSQL'])!;
    expect(checkLinkedinVariant(skills, { text: 'kubernetes, Go', factIds: [] })).toBe('Kubernetes · Go');
    expect(checkLinkedinVariant(skills, { text: 'Go · Rust', factIds: [] })).toBeNull();
    expect(checkLinkedinVariant(skills, { text: 'Go · go', factIds: [] })).toBeNull();
    expect(checkLinkedinVariant(skills, { text: 'Go · Kubernetes · PostgreSQL', factIds: [] })).toBeNull();
  });

  it('заголовок — до 220 знаков, на своих фактах', () => {
    const headline = linkedinVariantRequest('headline', INPUT, [])!;
    expect(checkLinkedinVariant(headline, { text: 'Руководитель разработки · Go · Kubernetes', factIds: ['resume:targetRole', 'resume:skill:s1'] }))
      .toBe('Руководитель разработки · Go · Kubernetes');
    expect(checkLinkedinVariant(headline, { text: 'x'.repeat(221), factIds: ['resume:targetRole'] })).toBeNull();
  });
});
