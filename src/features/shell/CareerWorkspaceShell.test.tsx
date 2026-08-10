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
import { createActionPackage } from '../action/actionPackageEngine';
import {
  analyzeOpportunity,
  createOpportunityRecord,
  recordOpportunityDecision,
} from '../opportunity/opportunityEngine';
import { recordOutcome } from '../outcome/outcomeEngine';
import { CareerWorkspaceShell } from './CareerWorkspaceShell';
import { CareerTariffsView } from './CareerTariffsView';

describe('CareerWorkspaceShell', () => {
  it('does not reveal a workspace or first-run form before session identity resolves', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell sessionPending workspace={prepareCareerWorkspace({
        resumeText: 'Синтетический профиль кандидата с достаточно длинным описанием для проверки приватной загрузки рабочего пространства.',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation: 'Проверяю, что чужие данные не появляются до завершения проверки сессии.',
        constraints: '',
        urgency: 'active',
      })} />,
    );

    expect(html).toContain('Проверяем защищённую сессию');
    expect(html).not.toContain('Синтетический профиль кандидата');
    expect(html).not.toContain('Начните с карьерного вопроса');
  });

  it('keeps a first-time candidate inside the canonical career shell', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        onClearWorkspace={() => undefined}
        onSaveWorkspace={() => undefined}
        onUpdateWorkspace={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="career-shell"');
    expect(html).toContain('Начните с карьерного вопроса');
    expect(html).toContain('Начать диагностику');
    expect(html).toContain('Можно начать без документов');
    expect(html).not.toContain('Посмотреть демо');
    expect(html).not.toContain('Выйти из демо');
    expect(html).not.toContain('Демо · синтетические данные');
    expect(html).toContain('Профиль</span><strong>Не заполнен</strong>');
    expect(html).not.toContain('С чем разобраться?');
    expect(html).toContain('Сегодня');
    expect(html).toContain('Профиль');
    expect(html).toContain('Карьера');
    expect(html).toContain('Возможности');
    expect(html).toContain('aria-label="Открыть аккаунт"');
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

  it('explains an opportunity through vacancy excerpts and confirmed evidence', () => {
    const base = prepareCareerWorkspace(
      {
        careerGoal: 'find-job',
        resumeText:
          'Руководил продуктовой командой. Формировал продуктовую стратегию и запускал B2B-продукты.',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation: 'Проверяю следующую продуктовую роль.',
        constraints: 'Гибридный формат.',
        urgency: 'active',
      },
      '2026-08-09T17:00:00.000Z',
    );
    const evidenceItems = (base.analysis?.evidenceItems ?? []).map((item) => ({
      ...item,
      status: 'confirmed' as const,
    }));
    const record = createOpportunityRecord({
      title: 'Senior Product Manager',
      company: 'Пример',
      sourceLabel: 'Ручной ввод',
      text: `
Задачи
Формировать продуктовую стратегию и управлять продуктовой командой.
Требования
Опыт запуска B2B-продуктов.
Уверенное владение SQL для продуктовой аналитики.
`,
    });
    const opportunity = {
      ...record,
      analysis: analyzeOpportunity(record, evidenceItems, 'unknown'),
    };
    const workspace = {
      ...base,
      analysis: base.analysis ? { ...base.analysis, evidenceItems } : undefined,
      opportunity,
    };
    const html = renderToStaticMarkup(
      <OpportunitiesView
        workspace={workspace}
        journey={buildCareerJourney(workspace)}
        onNavigate={() => undefined}
        onOpenExpert={() => undefined}
        onUpdateWorkspace={() => undefined}
      />,
    );

    expect(html).toContain('Почему такой маршрут');
    expect(html).toContain('Формировать продуктовую стратегию');
    expect(html).toContain('Есть опора в профиле');
    expect(html).toContain('Уверенное владение SQL для продуктовой аналитики');
    expect(html).toContain('Нужно подтвердить');
    expect(html).toContain('Принять решение');
  });

  it('renders a persisted action package after the candidate decides', () => {
    const base = prepareCareerWorkspace(
      {
        careerGoal: 'find-job',
        resumeText:
          'Руководил продуктовой командой. Формировал продуктовую стратегию и запускал B2B-продукты.',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        market: 'ru',
        currentSituation: 'Проверяю следующую продуктовую роль.',
        constraints: 'Гибридный формат.',
        urgency: 'active',
      },
      '2026-08-09T17:00:00.000Z',
    );
    const evidenceItems = (base.analysis?.evidenceItems ?? []).map((item) => ({
      ...item,
      status: 'confirmed' as const,
    }));
    const record = createOpportunityRecord({
      title: 'Senior Product Manager',
      company: 'Пример',
      sourceLabel: 'Ручной ввод',
      text: `
Задачи
Формировать продуктовую стратегию и управлять продуктовой командой.
Требования
Опыт запуска B2B-продуктов.
`,
    });
    const analyzed = {
      ...record,
      analysis: analyzeOpportunity(record, evidenceItems, 'unknown'),
    };
    const opportunity = recordOpportunityDecision(
      analyzed,
      'network',
      'Хочу уточнить задачи и уровень роли у команды.',
    );
    const actionPackage = createActionPackage(
      opportunity,
      evidenceItems,
      base.targetDirection,
    );
    const workspace = {
      ...base,
      analysis: base.analysis ? { ...base.analysis, evidenceItems } : undefined,
      opportunity,
      actionPackage,
    };
    const html = renderToStaticMarkup(
      <OpportunitiesView
        workspace={workspace}
        journey={buildCareerJourney(workspace)}
        onNavigate={() => undefined}
        onOpenExpert={() => undefined}
        onUpdateWorkspace={() => undefined}
      />,
    );

    expect(html).toContain('Решение сохранено');
    expect(html).toContain('Хочу уточнить задачи и уровень роли у команды.');
    expect(html).toContain('Пакет следующего действия');
    expect(html).toContain('Здравствуйте!');
    expect(html).toContain('Выбрать адресата');
    expect(html).toContain('Результат ещё не записан');
    expect(html).toContain('Отметить отправку');

    const contacted = recordOutcome(
      opportunity.id,
      {
        type: 'contacted',
        occurredAt: '2026-08-09T18:00:00.000Z',
        note: 'Сообщение отправлено в официальном интерфейсе.',
      },
      '2026-08-09T18:01:00.000Z',
    );
    const withOutcome = { ...workspace, outcomes: [contacted] };
    const outcomeHtml = renderToStaticMarkup(
      <OpportunitiesView
        workspace={withOutcome}
        journey={buildCareerJourney(withOutcome, '2026-08-09T18:02:00.000Z')}
        onNavigate={() => undefined}
        onOpenExpert={() => undefined}
        onUpdateWorkspace={() => undefined}
      />,
    );

    expect(outcomeHtml).toContain('Следующий шаг по факту');
    expect(outcomeHtml).toContain('Назначить дату проверки ответа');
    expect(outcomeHtml).toContain('Получен положительный ответ');
  });
});
