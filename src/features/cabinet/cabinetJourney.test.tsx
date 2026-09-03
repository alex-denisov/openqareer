import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AtsReadability, NextAction } from './CareerIntelligencePanelParts';
import { poolMarketObservations } from '../career-map/marketObservations';
import { cabinetJourney } from './cabinetJourney';
import type { CanonicalProfileMemory } from '../diagnostic/careerDiagnostic';

/**
 * Кабинет вошедшего кандидата строил карьерную картину только из браузерной
 * анкеты, а факты с сервера в неё не попадали: «ATS-читаемость» и «Следующее
 * действие» показывали пустые состояния тому, у кого разобрано резюме и есть
 * подтверждённые факты (B103, B105).
 */
const memory: CanonicalProfileMemory[] = [
  {
    id: 'fact-outcome',
    statement: 'Запустил продукт для 1200 пользователей и сократил срок релиза на 30 процентов.',
    kind: 'fact',
    domain: 'outcome',
    status: 'confirmed',
    sourceMessageIds: ['message-1'],
  },
  {
    id: 'fact-skill',
    statement: 'Веду продуктовую аналитику в SQL и Amplitude.',
    kind: 'fact',
    domain: 'skill',
    status: 'confirmed',
    sourceMessageIds: ['message-2'],
  },
  {
    id: 'question-role',
    statement: 'Не уверен, что название должности отражает работу.',
    kind: 'open-question',
    domain: 'role-evidence',
    status: 'proposed',
    sourceMessageIds: ['message-3'],
  },
];

describe('cabinetJourney', () => {
  it('строит карьерную картину из фактов кандидата на сервере, а не только из анкеты', () => {
    const journey = cabinetJourney({
      memory,
      targetDirection: 'Руководитель продукта',
      now: '2026-09-02T09:00:00.000Z',
    });

    expect(journey).toBeDefined();
    expect(journey?.diagnostic.findings.length).toBeGreaterThan(0);
  });

  it('без единого факта не выдумывает картину', () => {
    expect(cabinetJourney({ memory: [], targetDirection: '' })).toBeUndefined();
  });
});

describe('cabinetJourney on the screens that read it', () => {
  it('даёт «ATS-читаемости» проверки вместо предложения загрузить CV', () => {
    const journey = cabinetJourney({
      memory,
      targetDirection: 'Руководитель продукта',
      now: '2026-09-02T09:00:00.000Z',
    });

    const ats = renderToStaticMarkup(<AtsReadability journey={journey} onNavigate={() => undefined} />);
    expect(ats).toContain('проверок с фактом');
    expect(ats).not.toContain('Нужен исходный CV');

    const next = renderToStaticMarkup(<NextAction journey={journey} onNavigate={() => undefined} />);
    expect(next).toContain('Следующее действие');
    expect(next).not.toContain('Уточнить основу профиля');
  });
});

describe('cabinetJourney and the collected pool (B104)', () => {
  it('строит рынок по наблюдениям пула, а не объявляет выборку недостаточной', () => {
    const pool = Array.from({ length: 6 }, (_, index) => ({
      cluster: {
        id: `cluster-${index}`,
        canonicalTitle: 'Руководитель продукта',
        canonicalCompany: 'FinCloud',
        canonicalLocation: 'Москва',
        isRemote: false,
        descriptionSummary: '',
        skills: ['SQL', 'продуктовая аналитика'],
        primaryUrl: 'https://hh.ru/vacancy/1',
        sources: [
          {
            sourceType: 'hh',
            sourceId: `${index}`,
            sourceUrl: 'https://hh.ru/vacancy/1',
            observedAt: '2026-09-01T08:00:00.000Z',
          },
        ],
        firstObservedAt: '2026-09-01T08:00:00.000Z',
        lastSeenAt: '2026-09-02T08:00:00.000Z',
        status: 'active' as const,
        vacanciesCount: 1,
      },
      explanation: {
        clusterId: `cluster-${index}`,
        roleMatch: 'none' as const,
        matchingPoints: [],
        missingPoints: [],
        summary: '',
        calculatedAt: '2026-09-02T08:00:00.000Z',
      },
    }));

    expect(poolMarketObservations(pool).russia).toHaveLength(6);

    const journey = cabinetJourney({
      memory,
      targetDirection: 'Руководитель продукта',
      pool,
      now: '2026-09-02T09:00:00.000Z',
    });
    const russia = journey?.roleMarketMap?.markets.find((market) => market.id === 'ru');

    expect(russia?.sampleSize).toBe(6);
    expect(russia?.sampleStatus).toBe('fresh');
    expect(russia?.certainty).toBe('fact');
    expect(russia?.repeatedRequirements).toContain('SQL');
  });
});

describe('cabinetJourney market attribution (B104)', () => {
  it('не приписывает удалённую выборку конкретному региону кандидата', () => {
    const remotePool = Array.from({ length: 8 }, (_, index) => ({
      cluster: {
        id: `remote-${index}`,
        canonicalTitle: 'Product Manager',
        canonicalCompany: 'Lemon.io',
        canonicalLocation: 'Удалённо',
        isRemote: true,
        descriptionSummary: '',
        skills: ['product discovery'],
        primaryUrl: 'https://remotive.com/1',
        sources: [
          {
            sourceType: 'remotive',
            sourceId: `${index}`,
            sourceUrl: 'https://remotive.com/1',
            observedAt: '2026-09-01T08:00:00.000Z',
          },
        ],
        firstObservedAt: '2026-09-01T08:00:00.000Z',
        lastSeenAt: '2026-09-02T08:00:00.000Z',
        status: 'active' as const,
        vacanciesCount: 1,
      },
      explanation: {
        clusterId: `remote-${index}`,
        roleMatch: 'none' as const,
        matchingPoints: [],
        missingPoints: [],
        summary: '',
        calculatedAt: '2026-09-02T08:00:00.000Z',
      },
    }));

    const journey = cabinetJourney({
      memory,
      targetDirection: 'Product Manager',
      pool: remotePool,
      now: '2026-09-02T09:00:00.000Z',
    });
    const markets = journey?.roleMarketMap?.markets ?? [];

    // Ни один регион кандидата не выдаёт мировую удалённую выборку за свою.
    for (const market of markets.filter((item) => item.geography !== 'worldwide-remote')) {
      expect(market.sampleSize).toBe(0);
    }
    // Наблюдение существует и названо тем, чем является.
    const remote = markets.find((market) => market.geography === 'worldwide-remote');
    expect(remote?.sampleSize).toBe(8);
    expect(remote?.label).toContain('Удалённо');
  });
});
