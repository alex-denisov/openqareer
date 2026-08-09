import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CareerMapView,
  OpportunitiesView,
} from '../journey/CareerJourneyViews';
import {
  buildCareerJourney,
  prepareCareerWorkspace,
} from '../journey/careerJourneyEngine';
import { CareerWorkspaceShell } from './CareerWorkspaceShell';
import { CareerTariffsView } from './CareerTariffsView';

describe('CareerWorkspaceShell', () => {
  it('keeps a first-time candidate inside the canonical career shell', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        onClearWorkspace={() => undefined}
        onSaveWorkspace={() => undefined}
        onUpdateWorkspace={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="career-shell"');
    expect(html).toContain('С чем разобраться?');
    expect(html).toContain('Сегодня');
    expect(html).toContain('Профиль');
    expect(html).toContain('Карьера');
    expect(html).toContain('Возможности');
    expect(html).not.toContain('career-intent-list" role="list');
    expect(html).not.toContain('data-testid="workspace-setup"');
  });

  it('shows an honest free diagnostic before asking for more evidence', () => {
    const workspace = prepareCareerWorkspace(
      {
        careerGoal: 'find-job',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation:
          'После смены позиционирования стало заметно меньше приглашений на интервью.',
        constraints: 'Удалённая работа, без переезда в ближайшие шесть месяцев.',
        urgency: 'active',
      },
      '2026-08-09T17:00:00.000Z',
    );
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell workspace={workspace} />,
    );

    expect(html).toContain('Предварительная диагностика');
    expect(html).toContain('Цель: найти работу');
    expect(html).toContain('Сначала проверим основу поиска');
    expect(html).toContain('Материала недостаточно для полного разбора');
    expect(html).toContain('Не вывод: пока нет доказательств опыта');
    expect(html).not.toMatch(/универсальн.{0,8}(балл|оценк)/iu);
  });

  it('keeps the free diagnostic visible after a resume is added', () => {
    const workspace = prepareCareerWorkspace(
      {
        resumeText:
          'Руководил продуктовой командой из восьми человек. Запустил новый процесс исследования клиентов. Сократил срок проверки продуктовых гипотез на тридцать процентов. Отвечал за планирование, метрики и взаимодействие с коммерческой командой.',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation: 'Ищу следующую продуктовую роль и хочу проверить позиционирование.',
        constraints: 'Удалённая или гибридная работа.',
        urgency: 'active',
      },
      '2026-08-09T17:00:00.000Z',
    );
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell workspace={workspace} />,
    );

    expect(html).toContain('Предварительная диагностика');
    expect(html).toContain('Результаты пока не доказаны');
    expect(html).toContain('Нужно проверить');
  });

  it('keeps the route free until role and market evidence are ready', () => {
    const workspace = prepareCareerWorkspace(
      {
        careerGoal: 'find-job',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation:
          'После смены позиционирования стало заметно меньше приглашений на интервью.',
        constraints: 'Удалённая работа.',
        urgency: 'active',
      },
      '2026-08-09T17:00:00.000Z',
    );
    const journey = buildCareerJourney(
      workspace,
      '2026-08-09T17:05:00.000Z',
    );
    const html = renderToStaticMarkup(
      <OpportunitiesView
        workspace={workspace}
        journey={journey}
        onNavigate={() => undefined}
        onOpenExpert={() => undefined}
        onUpdateWorkspace={() => undefined}
      />,
    );

    expect(html).toContain('Сначала завершим бесплатную проверку маршрута');
    expect(html).not.toContain('Посмотреть объём работы');
  });

  it('separates available work, assisted pilot and unavailable automation', () => {
    const html = renderToStaticMarkup(
      <CareerTariffsView onOpenCoach={() => undefined} />,
    );

    expect(html).toContain('Доступно сейчас');
    expect(html).toContain('Сопровождаемый пилот');
    expect(html).toContain('Автопилот пока недоступен');
  });

  it('labels an old saved market sample as stale rather than fresh', () => {
    const base = prepareCareerWorkspace(
      {
        careerGoal: 'market',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation:
          'Хочу проверить, существует ли спрос на выбранную продуктовую роль.',
        constraints: 'Удалённая работа.',
        urgency: 'exploring',
      },
      '2025-12-01T12:00:00.000Z',
    );
    const workspace = {
      ...base,
      marketSample: {
        source: 'hh' as const,
        query: 'Руководитель продукта',
        found: 42,
        fetchedAt: '2025-12-01T12:04:00.000Z',
        items: [],
      },
    };
    const journey = buildCareerJourney(
      workspace,
      '2026-08-09T17:05:00.000Z',
    );
    const html = renderToStaticMarkup(
      <CareerMapView
        workspace={workspace}
        journey={journey}
        onNavigate={() => undefined}
        onOpenExpert={() => undefined}
        onUpdateWorkspace={() => undefined}
      />,
    );

    expect(html).toContain('Выборка устарела');
    expect(html).not.toContain('Свежие вакансии по гипотезе');
  });
});
