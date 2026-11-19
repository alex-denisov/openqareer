import { describe, expect, it } from 'vitest';
import { profileCurrent, type CurrentDraft } from './profileCurrent';

const place = (id: string, employer: string, title: string, over: Record<string, unknown> = {}) => ({
  id, chronologyMemoryId: `c-${id}`, employer, title, current: false, bulletMemoryIds: [] as string[], ...over,
});
const draft = (over: Partial<CurrentDraft> = {}): CurrentDraft => ({
  candidate: { headline: ' Engineering   Manager ', about: 'Руковожу группой. Строю процессы.' },
  experience: [
    place('e1', 'Финтех Лаб', 'Руководитель группы', { descriptionMemoryId: 'd1', bulletMemoryIds: ['b1'] }),
    place('e2', 'Сфера', 'Бэкенд', { bulletMemoryIds: ['b2'] }),
    place('e3', '', 'Без компании'),
  ],
  education: [
    { id: 'u1', evidenceMemoryId: 'x', institution: 'МГТУ им. Баумана', qualification: 'ИУ', startDate: '2009', endDate: '2014' },
    { id: 'u2', evidenceMemoryId: 'y', institution: 'Курсы' },
  ],
  courses: [{ id: 'k1', name: 'CKA', year: 2023 }, { id: 'k2', name: 'A' }, { id: 'k3', name: 'B' }, { id: 'k4', name: 'C' }],
  skills: [{ id: 's1', name: 'Go' }, { id: 's2', name: 'Kotlin' }, { id: 's3', name: 'Go' }],
  languages: [
    { id: 'l1', evidenceMemoryId: 'z', name: 'Русский', cefr: 'C2', sourceLabel: 'Native or bilingual proficiency' },
    { id: 'l2', evidenceMemoryId: 'z', name: 'Английский', cefr: 'B2' },
    { id: 'l3', evidenceMemoryId: 'z', name: 'Немецкий' },
  ],
  ...over,
} as CurrentDraft);

const statements = new Map([
  ['d1', 'Руковожу группой разработки платёжной платформы. 9 человек.'],
  ['b1', 'Релиз раз в 3 дня'],
  ['b2', 'Вела бэкенд шлюза'],
]);

describe('B645 a03: «сейчас» из импорта LinkedIn', () => {
  it('короткие строки по разделам, как в макете', () => {
    const { lines } = profileCurrent(draft(), statements);
    expect(lines).toEqual({
      headline: 'Engineering Manager',
      about: 'Руковожу группой. Строю процессы.',
      education: 'МГТУ им. Баумана · ИУ · 2009 — 2014 · ещё 1',
      courses: 'CKA · 2023 · ещё 3',
      skills: 'Go · Kotlin',
      languages: 'Русский — родной · Английский — B2 · Немецкий',
    });
  });

  it('опыт по местам: «Компания · Должность» и первое предложение описания', () => {
    expect(profileCurrent(draft(), statements).places).toEqual([
      { id: 'e1', label: 'Финтех Лаб · Руководитель группы', current: 'Руковожу группой разработки платёжной платформы.' },
      { id: 'e2', label: 'Сфера · Бэкенд', current: 'Вела бэкенд шлюза' },
      { id: 'e3', label: 'Без компании', current: null },
    ]);
  });

  it('пустые разделы — null, а не пустая строка', () => {
    const empty = draft({ candidate: {}, education: [], courses: undefined, skills: [], languages: [], experience: [] });
    expect(Object.values(profileCurrent(empty, new Map()).lines).every((line) => line === null)).toBe(true);
  });
});
