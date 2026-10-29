import { describe, expect, it } from 'vitest';
import type {
  ConnectionCircleResult as ConnectionCircle,
  VacancyConnectionCircles,
} from './vacancyLetterApi';
import { pathCircleCards, pathSourceNote, withReferralSent } from './vacancyPathCircles';

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

  it('adds the paths through platform members to circle 2, as a count only (B561)', () => {
    const base = data();
    const own = base.circles[0]!.paths.map((path) => ({ ...path, circle: 2 as const }));
    const withCircle2 = (circle2: VacancyConnectionCircles['circles'][number]) =>
      pathCircleCards({ ...base, circles: [base.circles[0]!, circle2, base.circles[2]!] })[1];

    expect(
      withCircle2({
        circle: 2,
        state: 'available',
        message: '',
        paths: own,
        platformPaths: { paths: 3 },
      }),
    ).toMatchObject({
      summary: '2 пути через знакомых и 3 через участников платформы.',
      actionLabel: 'Показать пути',
    });
    expect(
      withCircle2({
        circle: 2,
        state: 'none',
        message: '',
        paths: [],
        platformPaths: { paths: 1 },
      }),
    ).toMatchObject({ summary: '1 путь через участника платформы.' });
    expect(
      withCircle2({
        circle: 2,
        state: 'none',
        message: '',
        paths: [],
        platformPaths: { paths: 0 },
      }),
    ).toMatchObject({ summary: 'Путей через знакомых не найдено.' });
  });

  it('asks for a referral through platform members and says how it goes (B561 slice 3)', () => {
    const base = data();
    const card = (platformReferral: NonNullable<ConnectionCircle['platformReferral']>) =>
      pathCircleCards({
        ...base,
        circles: [
          base.circles[0]!,
          {
            circle: 2,
            state: 'none',
            message: '',
            paths: [],
            platformPaths: { paths: 3 },
            platformReferral,
          },
          base.circles[2]!,
        ],
      })[1];

    expect(card({ status: 'none', introducers: [] })).toMatchObject({
      summary: '3 пути через участников платформы.',
      actionLabel: 'Попросить рекомендацию',
      referralAction: 'ask',
    });
    expect(card({ status: 'pending', introducers: [] })).toMatchObject({
      summary: '3 пути через участников платформы. Запрос отправлен, ждём ответа.',
      referralAction: null,
    });
    expect(
      card({
        status: 'accepted',
        introducers: [{ fullName: 'Ulla Member', headline: null, linkedinUrl: null, people: [] }],
      }),
    ).toMatchObject({
      summary: '3 пути через участников платформы. Готовы рекомендовать: Ulla Member.',
      referralAction: null,
    });
    expect(card({ status: 'answered', introducers: [] })).toMatchObject({
      summary: '3 пути через участников платформы. Участники ответили, но помочь не смогут.',
      referralAction: null,
    });
  });

  it('shows a request just sent as pending without reloading the circles', () => {
    const base = data();
    const sent = withReferralSent({
      ...base,
      circles: [
        base.circles[0]!,
        { circle: 2, state: 'none', message: '', paths: [], platformPaths: { paths: 1 } },
        base.circles[2]!,
      ],
    });
    expect(sent.circles[1]!.platformReferral).toEqual({ status: 'pending', introducers: [] });
    expect(sent.circles[0]).toBe(base.circles[0]);
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
