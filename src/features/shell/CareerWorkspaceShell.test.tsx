import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CandidateSnapshot } from '../coach/coachApi';
import { CareerMapView, OpportunitiesView } from '../journey/CareerJourneyViews';
import { buildCareerJourney, prepareCareerWorkspace } from '../journey/careerJourneyEngine';
import { createActionPackage } from '../action/actionPackageEngine';
import {
  analyzeOpportunity,
  createOpportunityRecord,
  recordOpportunityDecision,
} from '../opportunity/opportunityEngine';
import { recordOutcome } from '../outcome/outcomeEngine';
import { CareerWorkspaceShell } from './CareerWorkspaceShell';
import { CareerTariffsView } from './CareerTariffsView';
import { CURRENT_PLAN } from './tariffPackages';

// Кабинет не рисует профиль до первого ответа сервера; здесь ответ приходит
// сразу, чтобы проверять состав оболочки, а не сеть.
vi.mock('../cabinet/useCareerCabinetData', () => ({
  useCareerCabinetData: () => ({
    snapshot: {
      candidate: { id: 'candidate-1', dataClass: 'synthetic', locale: 'ru-RU', createdAt: '2026-09-01T00:00:00.000Z' },
      messages: [],
      memory: [],
      turns: [],
      dossier: { sections: [], confirmedCount: 0, proposedCount: 0, readiness: { complete: false, unresolvedQuestions: 0, checks: [] } },
      assessments: [],
      germanyMarket: null,
      resume: null,
      documents: [],
      vacancySubscriptions: [],
    } as unknown as CandidateSnapshot,
    loading: false,
    refresh: async () => undefined,
    setAccount: () => undefined,
    setSnapshot: () => undefined,
  }),
}));

describe('CareerWorkspaceShell', () => {
  it('opens the authenticated candidate on a briefing that recommends one next step', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        session={{
          username: 'alexey',
          email: 'alexey@example.com',
          displayName: 'Мария Иванова',
          role: 'candidate',
          isTest: false,
          candidateId: 'candidate-1',
        }}
        workspace={prepareCareerWorkspace({
          resumeText:
            'Синтетический профиль кандидата с достаточно длинным описанием для проверки приватной загрузки рабочего пространства.',
          resumeSource: 'text',
          targetDirection: 'Руководитель продукта',
          regions: ['ru'],
          currentSituation:
            'Проверяю, что чужие данные не появляются до завершения проверки сессии.',
          constraints: '',
          urgency: 'active',
        })}
      />,
    );

    // «Главная» держит самого кандидата: профиль слева, оценка справа (B179).
    expect(html).toContain('Разделы профиля');
    expect(html).toContain('Оценка профиля');
    expect(html).not.toContain('Следующий шаг');
    expect(html).not.toContain('Диалог со стратегом');
    expect(html).not.toContain('Рынок и следующие шаги');
    expect(html).not.toContain('С чем разобраться?');
  });

  it('locks every workspace section until the diagnostic produced a career picture', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        session={{
          username: 'new_candidate',
          email: 'new@example.com',
          displayName: 'Новый Кандидат',
          role: 'candidate',
          isTest: false,
          candidateId: 'candidate-new',
        }}
      />,
    );

    for (const label of ['Поиск', 'Вакансии']) {
      expect(html).toContain(
        `aria-label="${label}. Завершите карьерную диагностику, чтобы открыть раздел"`,
      );
    }
    expect(html).toContain('aria-label="Главная"');
  });

  it('opens the diagnostic wizard for a newly signed-in candidate without a workspace', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        session={{
          username: 'new_candidate',
          email: 'new@example.com',
          displayName: 'Новый Кандидат',
          role: 'candidate',
          isTest: false,
          candidateId: 'candidate-new',
        }}
      />,
    );

    expect(html).toContain('С чем разобраться?');
    expect(html).not.toContain('Начать диагностику');
    expect(html).not.toContain('Карьерный кабинет');
  });

  it('does not reveal a workspace or first-run form before session identity resolves', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        sessionPending
        workspace={prepareCareerWorkspace({
          resumeText:
            'Синтетический профиль кандидата с достаточно длинным описанием для проверки приватной загрузки рабочего пространства.',
          resumeSource: 'text',
          targetDirection: 'Руководитель продукта',
          regions: ['ru'],
          currentSituation:
            'Проверяю, что чужие данные не появляются до завершения проверки сессии.',
          constraints: '',
          urgency: 'active',
        })}
      />,
    );

    // Владелец 2026-09-20: «проверяем защищённую сессию» на старте быть не
    // должно — профиль либо открывается, либо кандидат оказывается на входе.
    // Пока ответ идёт, экран молчит: тихая заглушка без заголовков и текста.
    expect(html).not.toContain('Проверяем защищённую сессию');
    expect(html).not.toContain('Защита данных');
    expect(html).toContain('career-session-gate');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('Синтетический профиль кандидата');
    expect(html).not.toContain('С чем разобраться?');
  });

  it('explains a session check that failed without the «checking» headline', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        sessionPending
        sessionError="Не удалось проверить аккаунт. Локальные карьерные данные скрыты до восстановления связи."
      />,
    );

    expect(html).not.toContain('Проверяем защищённую сессию');
    expect(html).not.toContain('Защита данных');
    expect(html).toContain('Не удалось проверить аккаунт');
    expect(html).toContain('Повторить проверку');
    expect(html).toContain('Открыть вход');
  });

  it('does not repeat the active navigation item in the top bar', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell onSaveWorkspace={() => undefined} />,
    );

    expect(html).not.toContain('career-page-name');
    expect(html).toContain('career-topbar');
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
    // The diagnostic opens on its first question: the welcome screen that used
    // to stand in front of it, and its «Не заполнен» status board, are gone
    // (B169 §4). Nothing else about the first-time shell changed.
    expect(html).toContain('С чем разобраться?');
    expect(html).not.toContain('Начать диагностику');
    expect(html).not.toContain('Профиль</span><strong>Не заполнен</strong>');
    expect(html).not.toContain('Посмотреть демо');
    expect(html).not.toContain('Выйти из демо');
    expect(html).not.toContain('Демо · синтетические данные');
    expect(html).toContain('Главная');
    expect(html).toContain('Поиск');
    expect(html).toContain('Вакансии');
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
        regions: ['ru'],
        currentSituation:
          'После смены позиционирования стало заметно меньше приглашений на интервью.',
        constraints: 'Удалённая работа, без переезда в ближайшие шесть месяцев.',
        urgency: 'active',
      },
      '2026-08-09T17:00:00.000Z',
    );
    const html = renderToStaticMarkup(<CareerWorkspaceShell workspace={workspace} />);

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
        regions: ['ru'],
        currentSituation: 'Ищу следующую продуктовую роль и хочу проверить позиционирование.',
        constraints: 'Удалённая или гибридная работа.',
        urgency: 'active',
      },
      '2026-08-09T17:00:00.000Z',
    );
    const html = renderToStaticMarkup(<CareerWorkspaceShell workspace={workspace} />);

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
        regions: ['ru'],
        currentSituation:
          'После смены позиционирования стало заметно меньше приглашений на интервью.',
        constraints: 'Удалённая работа.',
        urgency: 'active',
      },
      '2026-08-09T17:00:00.000Z',
    );
    const journey = buildCareerJourney(workspace, '2026-08-09T17:05:00.000Z');
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

  it('separates available work, assisted setup and unavailable automation', () => {
    const html = renderToStaticMarkup(<CareerTariffsView onOpenCoach={() => undefined} />);

    expect(html).toContain('Доступно сейчас');
    expect(html).toContain('Ручное сопровождение');
    expect(html).toContain('Автопилот пока недоступен');
  });

  it('labels an old saved market sample as stale rather than fresh', () => {
    const base = prepareCareerWorkspace(
      {
        careerGoal: 'market',
        resumeText: '',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        regions: ['ru'],
        currentSituation: 'Хочу проверить, существует ли спрос на выбранную продуктовую роль.',
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
    const journey = buildCareerJourney(workspace, '2026-08-09T17:05:00.000Z');
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
        regions: ['ru'],
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
        regions: ['ru'],
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
    const actionPackage = createActionPackage(opportunity, evidenceItems, base.targetDirection);
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

describe('CareerWorkspaceShell brand chrome', () => {
  it('wears the real openqareer sign in the rail and the topbar', () => {
    const html = renderToStaticMarkup(<CareerWorkspaceShell />);

    // The brand gradient only exists inside BrandMark, so its presence proves
    // the drawn sign replaced the stand-in Phosphor icon.
    expect(html).toContain('#0488F4');
    expect(html).toContain('brand-lockup');
  });

  it('ships no inline style attribute, which production CSP would drop', () => {
    // `style-src 'self'` on openqareer.com blocks style attributes outright, so
    // anything styled that way is styled only in development.
    expect(renderToStaticMarkup(<CareerWorkspaceShell />)).not.toContain('style="');
  });

  /**
   * B169 §5–§8 — the owner's reading of the built app: a top bar that repeats
   * the logo and offers a contextless «Эксперт» door, an account symbol in two
   * places, and «Тарифы» reachable in the middle of an unfinished diagnostic.
   */
  describe('shell chrome', () => {
    const firstTime = (
      <CareerWorkspaceShell
        onClearWorkspace={() => undefined}
        onSaveWorkspace={() => undefined}
        onUpdateWorkspace={() => undefined}
      />
    );

    it('closes «Тарифы» while the diagnostic is unfinished', () => {
      const html = renderToStaticMarkup(firstTime);
      const tariffs = /<button[^>]*aria-label="Тарифы\.[^"]*"[^>]*>/u.exec(html)?.[0];

      expect(tariffs, 'the rail renders a Тарифы button').toBeDefined();
      expect(tariffs).toContain('disabled');
      expect(tariffs).toContain('Завершите карьерную диагностику');
    });

    it('drops the contextless global expert door', () => {
      expect(renderToStaticMarkup(firstTime)).not.toContain('career-expert-trigger');
    });

    it('keeps the account control on the rail and nowhere else on desktop', () => {
      const html = renderToStaticMarkup(firstTime);
      const accountControls = html.match(/aria-label="Открыть аккаунт"/gu) ?? [];

      expect(html).toContain('career-account-button');
      // The second one is the narrow-screen bar, which is display:none on
      // desktop and is the only place those controls exist on a phone.
      expect(accountControls.length).toBe(2);
    });

    it('collapses the rail by default and offers a handle to open it', () => {
      const html = renderToStaticMarkup(firstTime);

      expect(html).toContain('data-rail="collapsed"');
      expect(html).toContain('career-rail-toggle');
      expect(html).toContain('aria-controls="career-rail"');
      expect(html).toContain('aria-label="Развернуть панель"');
      // Collapsed the rail shows the sign alone; the wordmark arrives with the
      // section labels when the handle opens it.
      const rail = html.slice(html.indexOf('<aside id="career-rail"'), html.indexOf('</aside>'));
      expect(rail).toContain('career-brand-mark');
      expect(rail).not.toContain('brand-lockup-qareer');
    });

    /**
     * The handle used to float over the workspace on the rail's outer border,
     * where it covered whatever the candidate was reading (owner report,
     * 2026-08-26). It belongs in the rail's own bottom group, with the account
     * control it sits beside.
     */
    it('keeps the handle inside the rail rather than floating over the page', () => {
      const html = renderToStaticMarkup(firstTime);
      const bottom = html.slice(
        html.indexOf('career-rail-bottom'),
        html.indexOf('</aside>'),
      );

      expect(bottom).toContain('career-rail-toggle');
      expect(bottom).toContain('career-account-button');
    });

    /**
     * Production serves `style-src 'self'`, which drops the style attribute
     * outright, so a link styled that way is unstyled for every real visitor
     * (PRB-012). The admin entry point used to carry seven such declarations.
     */
    it('styles the administrator link with a class, not a blocked attribute', () => {
      const html = renderToStaticMarkup(
        <CareerWorkspaceShell
          session={{
            username: 'root',
            role: 'admin',
            candidateId: 'candidate-1',
          } as never}
          onClearWorkspace={() => undefined}
          onSaveWorkspace={() => undefined}
          onUpdateWorkspace={() => undefined}
        />,
      );

      expect(html).toContain('Админка');
      expect(html).toContain('career-rail-admin');
      expect(html).not.toContain('style="');
    });

    it('names the vacancy section consistently without using Шансы', () => {
      const html = renderToStaticMarkup(firstTime);
      expect(html).toContain('Вакансии');
      expect(html).not.toContain('Шансы');
    });
  });
});

/**
 * «Пульт» (B178). Рельс называл разделы чужими глифами из набора: дом для
 * кандидата, пустой лист для «Резюме». Тариф
 * стоял пунктом меню в одном ряду с «Карьерой», а «Свернуть» занимало ещё
 * один пункт. Иконка теперь рисуется под раздел, тариф — карточка плана,
 * ручка — не пункт меню.
 */
describe('рельс «Пульт»', () => {
  function railHtml() {
    return renderToStaticMarkup(
      <CareerWorkspaceShell
        session={{
          username: 'alexey',
          email: 'alexey@example.com',
          displayName: 'Мария Иванова',
          role: 'candidate',
          isTest: false,
          candidateId: 'candidate-1',
        }}
        workspace={prepareCareerWorkspace({
          resumeText:
            'Синтетический профиль кандидата с достаточно длинным описанием для проверки рельса.',
          resumeSource: 'text',
          targetDirection: 'Руководитель продукта',
          regions: ['ru'],
          currentSituation: 'Проверяю навигацию.',
          constraints: '',
          urgency: 'active',
        })}
      />,
    );
  }

  it('даёт каждому разделу свою иконку, а не один глиф на всех', () => {
    const paths = [
      ...railHtml().matchAll(/<button class="career-nav-button[^]*?<\/button>/gu),
    ].map((match) => match[0].replace(/[^]*?(<svg[^]*?<\/svg>)[^]*/u, '$1'));

    // Три раздела макета, каждый нарисован дважды: рельс и нижняя панель на
    // узком экране. Важно, что рисунков ровно три разных (B179).
    expect(paths.length).toBe(6);
    expect(new Set(paths).size).toBe(3);
  });

  it('называет план, который действительно работает, а не выдуманный', () => {
    const html = railHtml();

    expect(html).toContain(`план «${CURRENT_PLAN.name}»`);
    // Тариф — карточка, а не пункт меню рядом с разделами.
    expect(html).toContain('career-plan-card');
  });

  it('не тратит пункт меню на ручку раскрытия', () => {
    const html = railHtml();
    const railToggle = html.match(
      /<button class="career-rail-toggle"[^]*?<\/button>/u,
    );

    expect(railToggle).not.toBeNull();
    expect(railToggle![0]).not.toContain('career-nav-button');
    expect(railToggle![0]).not.toContain('<span>Свернуть</span>');
  });
});
