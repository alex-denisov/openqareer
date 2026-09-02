import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RolesMarketPanel } from './RolesMarketPanel';
import { cabinetJourney } from './cabinetJourney';
import type { CanonicalProfileMemory } from '../diagnostic/careerDiagnostic';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';

const memory: CanonicalProfileMemory[] = [
  {
    id: 'fact-outcome',
    statement: 'Запустил продукт для 1200 пользователей и сократил срок релиза на 30 процентов.',
    kind: 'fact',
    domain: 'outcome',
    status: 'confirmed',
    sourceMessageIds: ['message-1'],
  },
];

function poolOf(count: number): MatchedVacancyItem[] {
  return Array.from({ length: count }, (_, index) => ({
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
      matchScore: 0,
      fitLevel: 'potential' as const,
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-02T08:00:00.000Z',
    },
  })) as MatchedVacancyItem[];
}

function render(count: number, read: { complete?: boolean; poolTotal?: number } = {}) {
  return renderToStaticMarkup(
    <RolesMarketPanel
      journey={cabinetJourney({
        memory,
        targetDirection: 'Руководитель продукта',
        pool: poolOf(count),
        now: '2026-09-02T09:00:00.000Z',
      })}
      poolComplete={read.complete ?? true}
      poolTotal={read.poolTotal ?? count}
      onNavigate={() => undefined}
    />,
  );
}

describe('RolesMarketPanel', () => {
  it('называет выборку числом, датой наблюдения и источником', () => {
    const html = render(6);
    expect(html).toContain('Роли и рынок');
    expect(html).toContain('6 вакансий');
    expect(html).toContain('1 сентября');
    expect(html).toContain('SQL');
  });

  it('на маленькой выборке отказывается говорить о рынке, а не показывает пустые числа', () => {
    const html = render(2);
    expect(html).toContain('Выборки не хватает');
    expect(html).not.toContain('2 вакансий в рынке');
  });

  it('без карты ролей не рисует раздел вовсе', () => {
    expect(renderToStaticMarkup(<RolesMarketPanel onNavigate={() => undefined} />)).toBe('');
  });
});

describe('RolesMarketPanel while the pool is still being read', () => {
  it('говорит, что выборка считается по прочитанной части, а не по всему пулу', () => {
    const html = render(6, { complete: false, poolTotal: 514 });
    expect(html).toContain('прочитано 6 из 514');
  });

  it('на прочитанном пуле лишнего не пишет', () => {
    expect(render(6)).not.toContain('прочитано');
  });
});
