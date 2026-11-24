import { describe, expect, it } from 'vitest';
import type { ResumeDraft, ResumeExperienceInput } from '../../resume/resumeTypes';
import {
  experienceSummary,
  headLine,
  jobRow,
  languageRow,
  periodLabel,
  recordRows,
  splitVisible,
  teamLabel,
} from './profileModel';

function job(overrides: Partial<ResumeExperienceInput>): ResumeExperienceInput {
  return {
    id: 'e1',
    chronologyMemoryId: 'm0',
    title: 'Руководитель группы разработки',
    employer: 'Финтех Лаб',
    startDate: '2021-03',
    current: true,
    bulletMemoryIds: ['m1', 'm2'],
    ...overrides,
  };
}

const STATEMENTS = new Map([
  ['m1', 'Релиз раз в 3 дня вместо 2 недель'],
  ['m2', 'Перевела платформу на Kubernetes'],
]);

describe('b640 profile: запись опыта', () => {
  it('период: годы, «сейчас» у текущего места', () => {
    expect(periodLabel(job({}))).toBe('2021 — сейчас');
    expect(periodLabel(job({ current: false, startDate: '2018-03', endDate: '2021-01' }))).toBe(
      '2018 — 2021',
    );
    expect(periodLabel(job({ current: false, startDate: '2020', endDate: '2020-11' }))).toBe(
      '2020',
    );
    expect(periodLabel(job({ current: false, startDate: undefined, endDate: undefined }))).toBe('');
  });

  it('команда склоняется, без размера подписи нет', () => {
    expect(teamLabel(9)).toBe('9 человек');
    expect(teamLabel(4)).toBe('4 человека');
    expect(teamLabel(1)).toBe('1 человек');
    expect(teamLabel(undefined)).toBeNull();
    expect(teamLabel(0)).toBeNull();
  });

  it('строка места: результаты из фактов, стек, адрес правки', () => {
    expect(jobRow(job({ teamSize: 9, skills: ['Go', 'Kotlin'] }), STATEMENTS)).toEqual({
      id: 'e1',
      title: 'Руководитель группы разработки',
      employer: 'Финтех Лаб',
      period: '2021 — сейчас',
      team: '9 человек',
      results: ['Релиз раз в 3 дня вместо 2 недель', 'Перевела платформу на Kubernetes'],
      stack: 'Go, Kotlin',
      editPath: '/app/profile/experience/e1',
    });
  });

  it('факт без текста пропускает, пустые поля не выдумывает', () => {
    const row = jobRow(
      job({ title: undefined, employer: undefined, bulletMemoryIds: ['m1', 'нет'] }),
      STATEMENTS,
    );
    expect(row).toMatchObject({
      title: 'Должность не указана',
      employer: '',
      results: ['Релиз раз в 3 дня вместо 2 недель'],
      stack: '',
      team: null,
    });
  });

  it('итог раздела: стаж по годам и число мест', () => {
    const list = [
      job({}),
      job({ id: 'e2', current: false, startDate: '2014-06', endDate: '2021-01' }),
    ];
    expect(experienceSummary(list, new Date('2026-11-17T00:00:00Z'))).toBe('12 лет · 2 места');
    expect(
      experienceSummary([job({ startDate: undefined })], new Date('2026-11-17T00:00:00Z')),
    ).toBe('1 место');
    expect(experienceSummary([], new Date())).toBe('');
  });
});

describe('b640 profile: шапка и списки', () => {
  const draft = {
    candidate: {
      fullName: 'Марина Соколова',
      headline: 'Руководитель группы разработки',
      contact: { location: 'Москва' },
    },
    experience: [],
    education: [
      {
        id: 'ed1',
        evidenceMemoryId: 'x',
        institution: 'МГТУ им. Баумана',
        qualification: 'Информатика',
        startDate: '2009-09',
        endDate: '2014-07',
      },
      { id: 'ed2', evidenceMemoryId: 'x' },
    ],
    courses: [{ id: 'c1', name: 'Go: продвинутый курс', provider: 'Онлайн-школа', year: 2019 }],
    projects: [
      {
        id: 'p1',
        name: 'Платформа релизов',
        employer: 'Финтех Лаб',
        startDate: '2022',
        endDate: '2023',
      },
    ],
    recommendations: [
      {
        id: 'r1',
        recommender: 'Игорь Власов',
        role: 'директор по разработке',
        organization: 'Сфера Платежи',
        text: 'Сильная группа',
      },
    ],
    languages: [],
  } as unknown as ResumeDraft;

  it('строка под именем: должность и город', () => {
    expect(headLine(draft)).toBe('Руководитель группы разработки · Москва');
    expect(headLine({ ...draft, candidate: {} } as ResumeDraft)).toBe('');
  });

  it('образование, курсы, проекты и рекомендации — заголовок и подпись; пустые записи не показывает', () => {
    const rows = recordRows(draft);
    expect(rows.education).toEqual([
      { id: 'ed1', title: 'МГТУ им. Баумана', sub: 'Информатика · 2009 — 2014' },
    ]);
    expect(rows.courses).toEqual([
      { id: 'c1', title: 'Go: продвинутый курс', sub: 'Онлайн-школа · 2019' },
    ]);
    expect(rows.projects).toEqual([
      { id: 'p1', title: 'Платформа релизов', sub: 'Финтех Лаб · 2022 — 2023' },
    ]);
    expect(rows.recommendations).toEqual([
      {
        id: 'r1',
        title: 'Игорь Власов, директор по разработке, Сфера Платежи',
        sub: '«Сильная группа»',
      },
    ]);
  });

  it('язык: уровень и шкала из шести делений', () => {
    expect(
      languageRow({ id: 'l1', evidenceMemoryId: 'x', name: 'Английский', cefr: 'B2' }),
    ).toEqual({
      id: 'l1',
      name: 'Английский',
      level: 'B2',
      filled: 4,
    });
    expect(languageRow({ id: 'l2', evidenceMemoryId: 'x', name: 'Немецкий' })).toEqual({
      id: 'l2',
      name: 'Немецкий',
      level: null,
      filled: 0,
    });
    expect(languageRow({ id: 'l3', evidenceMemoryId: 'x' })).toBeNull();
  });

  it('B645 23.11: язык из LinkedIn по-английски — по словарю языков по-русски', () => {
    expect(
      languageRow({ id: 'l4', evidenceMemoryId: 'x', name: 'english', cefr: 'C1' })?.name,
    ).toBe('Английский');
    expect(languageRow({ id: 'l5', evidenceMemoryId: 'x', name: 'Russian' })?.name).toBe('Русский');
    // Языка нет в словаре — как записан.
    expect(languageRow({ id: 'l6', evidenceMemoryId: 'x', name: 'Esperanto' })?.name).toBe(
      'Esperanto',
    );
  });

  it('длинный список: первые записи и остаток под «Ещё N»', () => {
    expect(splitVisible([1, 2, 3, 4, 5], 2)).toEqual({ shown: [1, 2], rest: [3, 4, 5] });
    expect(splitVisible([1, 2], 2)).toEqual({ shown: [1, 2], rest: [] });
  });
});
