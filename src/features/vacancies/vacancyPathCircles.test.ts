import { describe, expect, it } from 'vitest';
import type { VacancyConnectionCircles } from './vacancyLetterApi';
import { pathCircleCards, pathSourceNote, platformMemberMessage } from './vacancyPathCircles';

function person(id: string, fullName: string, roleTitle: string | null = null) {
  return { id, fullName, roleTitle, companyName: 'Вектор Банк' };
}

function data(overrides: Partial<VacancyConnectionCircles> = {}): VacancyConnectionCircles {
  return {
    vacancyId: 'v1',
    companyKey: 'vector',
    companyName: 'Вектор Банк',
    vacancyTitle: 'Head of Engineering',
    circles: [
      {
        circle: 1,
        state: 'available',
        message: '',
        paths: [
          {
            id: 'p1',
            circle: 1,
            path: [],
            recipient: person('a', 'Ирина Захарова', 'Director of Product'),
            evidence: ['Работали вместе в Маркет Софт'],
            strength: 'direct',
            source: 'work_history',
            nextStep: 'write_known_contact',
          },
          {
            id: 'p2',
            circle: 1,
            path: [],
            recipient: person('b', 'Павел Рыжов'),
            evidence: [],
            strength: 'strong',
            source: 'linkedin_import',
            nextStep: 'write_known_contact',
          },
        ],
      },
      { circle: 2, state: 'unknown', message: '', paths: [] },
      { circle: 3, state: 'available', message: 'Подготовьте холодный отклик.', paths: [] },
    ],
    linkedinImport: {
      state: 'imported',
      importedAt: '2026-09-12T10:00:00.000Z',
      importedCount: 412,
    },
    ...overrides,
  };
}

describe('pathCircleCards (B549)', () => {
  it('describes the three circles from the circles API', () => {
    const [c1, c2, c3] = pathCircleCards(data());
    expect(c1).toMatchObject({
      circle: 1,
      label: 'Круг 1',
      title: 'Знакомый в компании',
      summary: '2 контакта работают в Вектор Банк.',
      actionLabel: 'Написать знакомому',
      known: true,
    });
    expect(c2).toMatchObject({
      circle: 2,
      title: 'Через знакомого',
      summary: 'Контакты неизвестны: импортируйте контакты LinkedIn или добавьте знакомых.',
      actionLabel: 'Добавить контакты',
      known: false,
    });
    expect(c3).toMatchObject({
      circle: 3,
      title: 'Холодный отклик',
      summary: 'Подготовьте холодный отклик.',
      actionLabel: 'Подготовить письмо',
      known: true,
    });
  });

  it('counts paths through a contact for circle 2', () => {
    const base = data();
    const paths = base.circles[0]!.paths.map((path) => ({ ...path, circle: 2 as const }));
    const cards = pathCircleCards({
      ...base,
      circles: [
        base.circles[0]!,
        { circle: 2, state: 'available', message: '', paths },
        base.circles[2]!,
      ],
    });
    expect(cards[1]).toMatchObject({
      summary: '2 пути через знакомых.',
      actionLabel: 'Показать пути',
    });
  });

  it('adds the platform members who know people at the company to circle 2 (B561)', () => {
    const base = data();
    const own = base.circles[0]!.paths.map((path) => ({ ...path, circle: 2 as const }));
    const member = { fullName: 'Ulla Member', linkedinUrl: null, personName: 'Jane Roe' };
    const withCircle2 = (circle2: VacancyConnectionCircles['circles'][number]) =>
      pathCircleCards({ ...base, circles: [base.circles[0]!, circle2, base.circles[2]!] })[1];

    expect(
      withCircle2({
        circle: 2,
        state: 'available',
        message: '',
        paths: own,
        platformMembers: { count: 3, members: [member] },
      }),
    ).toMatchObject({
      summary: '2 пути через знакомых и 3 участника платформы знают людей в Вектор Банк.',
      actionLabel: 'Показать пути',
    });
    expect(
      withCircle2({
        circle: 2,
        state: 'none',
        message: '',
        paths: [],
        platformMembers: { count: 1, members: [member] },
      }),
    ).toMatchObject({ summary: '1 участник платформы знает людей в Вектор Банк.', known: true });
    expect(
      withCircle2({
        circle: 2,
        state: 'none',
        message: '',
        paths: [],
        platformMembers: { count: 0, members: [] },
      }),
    ).toMatchObject({ summary: 'Путей через знакомых не найдено.' });
  });

  it('writes the first LinkedIn message to a platform member (B561)', () => {
    expect(
      platformMemberMessage(
        { fullName: 'Ulla Member', linkedinUrl: null, personName: 'Jane Roe' },
        'Вектор Банк',
      ),
    ).toBe(
      'Привет! Я тоже пользуюсь OpenQareer и хотел спросить про Вектор Банк: вижу, у тебя в контактах Jane Roe. Познакомишь или подскажешь, как лучше написать?',
    );
  });

  it('is honest when a known circle has no contacts', () => {
    const base = data();
    const cards = pathCircleCards({
      ...base,
      circles: [
        { circle: 1, state: 'none', message: '', paths: [] },
        base.circles[1]!,
        base.circles[2]!,
      ],
    });
    expect(cards[0]).toMatchObject({
      summary: 'Знакомых в Вектор Банк не найдено.',
      actionLabel: 'Добавить контакты',
      known: false,
    });
  });
});

describe('pathSourceNote (B549)', () => {
  it('names the import, its size and date', () => {
    expect(pathSourceNote(data())).toBe(
      'Связи — из импорта контактов LinkedIn, 412 контактов, 12.09.2026.',
    );
  });

  it('says contacts are unknown without an import', () => {
    expect(
      pathSourceNote(
        data({ linkedinImport: { state: 'unknown', importedAt: null, importedCount: null } }),
      ),
    ).toBe('Контакты LinkedIn не импортированы, поэтому круги 1 и 2 неизвестны.');
  });
});
