import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RolesMarketPanel } from './RolesMarketPanel';
import { cabinetJourney } from './cabinetJourney';
import type { ProposedRole } from '../../../shared/roleProposals';
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

describe('RolesMarketPanel: роль называет модель, пул подтверждает (B180 срез 1в)', () => {
  const journey = () =>
    cabinetJourney({
      memory,
      targetDirection: 'Руководитель продукта',
      pool: poolOf(9),
      now: '2026-09-02T09:00:00.000Z',
    });

  function render(roles: ProposedRole[]): string {
    return renderToStaticMarkup(
      <RolesMarketPanel journey={journey()} proposedRoles={roles} onNavigate={() => undefined} />,
    );
  }

  const observed: ProposedRole = {
    id: 'role-product',
    title: 'Руководитель продукта',
    origin: 'model',
    reason: 'девять лет вели внутренние продукты',
    evidenceRefs: ['memory:1'],
    confirmation: {
      state: 'observed',
      sampleSize: 9,
      observedFrom: '2026-09-01T08:00:00.000Z',
      observedTo: '2026-09-02T08:00:00.000Z',
      sources: [{ source: 'hh', count: 9 }],
      repeatedRequirements: ['SQL'],
      matchedRequirements: 1,
    },
  };

  const notFound: ProposedRole = {
    id: 'role-growth',
    title: 'Head of Growth',
    origin: 'model',
    reason: 'запускали рост в двух компаниях',
    evidenceRefs: ['memory:2'],
    confirmation: { state: 'not-found' },
  };

  it('печатает подтверждённую роль с её выборкой и источником', () => {
    const html = render([observed]);

    expect(html).toContain('Руководитель продукта');
    expect(html).toContain('9 вакансий');
    expect(html).toContain('hh.ru');
  });

  it('роль без вакансий остаётся на экране и говорит, что делать', () => {
    const html = render([observed, notFound]);

    expect(html).toContain('Head of Growth');
    expect(html).toContain('Пока не найдено в наших источниках');
    expect(html).toContain('шире фильтр');
  });

  it('не выдаёт названное моделью за наблюдение рынка', () => {
    const html = render([notFound]);

    expect(html).toContain('названо по вашему опыту');
    expect(html).not.toContain('вакансий ·');
  });

  it('малую выборку показывает числом и не печатает требований', () => {
    const html = render([
      { ...notFound, confirmation: { state: 'too-few', sampleSize: 3 } },
    ]);

    const pending = html.slice(
      html.indexOf('career-roles-pending'),
      html.indexOf('career-market-list'),
    );
    expect(pending).toContain('Найдено 3');
    expect(pending).toContain('рано делать выводы');
    // Требования на выборке меньше восьми не агрегируются: их переворачивает
    // один работодатель со своим шаблоном.
    expect(pending).not.toContain('Повторяются');
  });

  it('когда модель не назвала ничего и рынок молчит — говорит об этом прямо', () => {
    expect(render([])).toContain('Роль ещё не названа');
  });

  it('печатает названные роли и без карты ролей журнала', () => {
    // На проде маршрут отдавал пять ролей, а панель не рисовалась вовсе:
    // ранний выход по `journey.roleMarketMap` прятал и то, что от карты не
    // зависит (B180, прод-проверка 5b5a85b).
    const html = renderToStaticMarkup(
      <RolesMarketPanel proposedRoles={[observed, notFound]} onNavigate={() => undefined} />,
    );

    expect(html).toContain('Руководитель продукта');
    expect(html).toContain('Head of Growth');
  });
});

describe('RolesMarketPanel: выбор роли в «Стратегию» (B180 срез 2)', () => {
  const role: ProposedRole = {
    id: 'role-head-of-product',
    title: 'Head of Product',
    origin: 'model',
    reason: 'вёл продукты девять лет',
    evidenceRefs: ['memory:1'],
    confirmation: { state: 'not-found' },
  };

  function render(choice?: {
    chosenTitle?: string;
    onChoose?: (title: string, reason?: string) => void;
  }): string {
    return renderToStaticMarkup(
      <RolesMarketPanel
        proposedRoles={[role]}
        onNavigate={() => undefined}
        {...(choice ? { choice } : {})}
      />,
    );
  }

  it('без обработчика выбора кнопок не рисует вовсе', () => {
    const html = render();
    expect(html).toContain('Head of Product');
    expect(html).not.toContain('Выбрать эту роль');
  });

  it('первый выбор предлагает кнопкой, без вопроса о причине', () => {
    const html = render({ onChoose: () => undefined });
    expect(html).toContain('Выбрать эту роль');
    expect(html).not.toContain('Почему меняете');
  });

  it('выбранную роль помечает и второй раз выбрать не предлагает', () => {
    const html = render({ chosenTitle: 'head of product', onChoose: () => undefined });
    expect(html).toContain('ваша роль');
    expect(html).not.toContain('Выбрать эту роль');
    expect(html).not.toContain('Сменить роль на эту');
  });

  it('при уже выбранной другой роли зовёт сменить, а не выбрать', () => {
    const html = render({ chosenTitle: 'Product Manager', onChoose: () => undefined });
    expect(html).toContain('Сменить роль на эту');
    expect(html).not.toContain('Выбрать эту роль');
  });
});
