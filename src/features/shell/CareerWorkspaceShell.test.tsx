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
import { CareerMobileTopbar } from './CareerShellNavigation';
import { CareerTariffsView } from './CareerTariffsView';
import type { ShellSection } from './shellNavigation';

// Кабинет не рисует профиль до первого ответа сервера; здесь ответ приходит
// сразу, чтобы проверять состав оболочки, а не сеть.
vi.mock('../cabinet/useCareerCabinetData', () => ({
  useCareerCabinetData: () => ({
    snapshot: {
      candidate: {
        id: 'candidate-1',
        dataClass: 'synthetic',
        locale: 'ru-RU',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      messages: [],
      memory: [],
      turns: [],
      dossier: {
        sections: [],
        confirmedCount: 0,
        proposedCount: 0,
        readiness: { complete: false, unresolvedQuestions: 0, checks: [] },
      },
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
    expect(html).toContain('career-today');
    expect(html).toContain('<h1>Сегодня</h1>');
    expect(html).not.toContain('Следующий шаг');
    expect(html).not.toContain('Диалог со стратегом');
    expect(html).not.toContain('Рынок и следующие шаги');
    expect(html).not.toContain('С чем разобраться?');
  });

  it('waits for profile work status before rendering the authenticated diary', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        initialView="diary"
        session={{
          username: 'candidate',
          email: 'candidate@example.com',
          displayName: 'Кандидат',
          role: 'candidate',
          isTest: false,
          candidateId: 'candidate-diary',
        }}
      />,
    );

    expect(html).toContain('Проверяем место работы из профиля');
    expect(html).not.toContain('career-diary-page');
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

    for (const label of ['Профиль', 'Вакансии']) {
      expect(html).toContain(
        `aria-label="${label}. Завершите карьерную диагностику, чтобы открыть раздел"`,
      );
    }
    expect(html).toContain('aria-label="Сегодня"');
  });

  it('opens FirstRun in the career shell for a newly signed-in candidate without a workspace', () => {
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

    expect(html).toContain('data-testid="first-run-wizard"');
    expect(html).toContain('Находка себя');
    expect(html).not.toContain('С чем разбираемся?');
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

    expect(html).toContain('career-session-gate');
    expect(html).toContain('career-today-skeleton');
    expect(html).toContain('Проверяем вход и читаем ваш профиль');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('Синтетический профиль кандидата');
    expect(html).not.toContain('data-testid="first-run-wizard"');
  });

  it('explains a failed session check and offers retry and sign-in', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell
        sessionPending
        sessionError="Не удалось проверить аккаунт. Локальные карьерные данные скрыты до восстановления связи."
      />,
    );

    expect(html).toContain('Ошибка: сервер не ответил.');
    expect(html).toContain('Повторить');
    expect(html).toContain('Открыть вход');
  });

  it('does not repeat the active navigation item in the top bar', () => {
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
            'Синтетический профиль кандидата с достаточно длинным описанием для проверки шапки.',
          resumeSource: 'text',
          targetDirection: 'Руководитель продукта',
          regions: ['ru'],
          currentSituation: 'Проверяю шапку.',
          constraints: '',
          urgency: 'active',
        })}
        onSaveWorkspace={() => undefined}
      />,
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
    // The new user starts in FirstRun inside the canonical career shell.
    expect(html).toContain('data-testid="first-run-wizard"');
    expect(html).toContain('Находка себя');
    expect(html).not.toContain('С чем разбираемся?');
    expect(html).not.toContain('Начать диагностику');
    expect(html).not.toContain('Профиль</span><strong>Не заполнен</strong>');
    expect(html).not.toContain('Посмотреть демо');
    expect(html).not.toContain('Выйти из демо');
    expect(html).not.toContain('Демо · синтетические данные');
    expect(html).toContain('Сегодня');
    expect(html).toContain('Профиль');
    expect(html).toContain('Вакансии');
    expect(html).toContain('Отклики');
    expect(html).toContain('first-run-consultant-sidebar');
    expect(html).toContain('Консультант');
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
    expect(html).toContain('Пока недоступна');
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
  it('keeps the brand sign in the rail and names the first-run topbar', () => {
    const html = renderToStaticMarkup(<CareerWorkspaceShell />);

    // The rail keeps the brand sign while first run uses its page title.
    expect(html).toContain('#0488F4');
    expect(html).toContain('career-mobile-page-title');
    expect(html).toContain('Старт');
  });

  it('ships no inline style attribute, which production CSP would drop', () => {
    // `style-src 'self'` on openqareer.com blocks style attributes outright, so
    // anything styled that way is styled only in development.
    expect(renderToStaticMarkup(<CareerWorkspaceShell />)).not.toContain('style="');
  });

  describe('shell chrome', () => {
    const candidateSession = {
      username: 'alexey',
      email: 'alexey@example.com',
      displayName: 'Мария Иванова',
      role: 'candidate' as const,
      isTest: false,
      candidateId: 'candidate-1',
    };
    const workspace = prepareCareerWorkspace({
      resumeText: 'Синтетический профиль кандидата.',
      resumeSource: 'text',
      targetDirection: 'Руководитель продукта',
      regions: ['ru'],
      currentSituation: 'Проверяю фиксированную оболочку.',
      constraints: '',
      urgency: 'active',
    });
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell session={candidateSession} workspace={workspace} />,
    );

    it('keeps the openqareer mark and removes the contextless expert door', () => {
      expect(html).toContain('career-brand-mark');
      expect(html).not.toContain('career-expert-trigger');
    });

    it('keeps the account control without exposing its name or email in the rail', () => {
      const rail = html.slice(html.indexOf('<aside id="career-rail"'), html.indexOf('</aside>'));
      expect(rail).toContain('career-account-button');
      expect(rail).not.toContain('Мария Иванова');
      expect(rail).not.toContain('alexey@example.com');
    });

    it('removes the collapsing control and shows wallet tariffs', () => {
      const rail = html.slice(html.indexOf('<aside id="career-rail"'), html.indexOf('</aside>'));
      expect(rail).not.toContain('career-rail-toggle');
      expect(rail).toContain('career-rail-wallet');
      expect(rail).toContain('aria-label="Тарифы"');
      expect(rail).toContain('<svg');
    });

    it('keeps tariff and account actions in More beside four primary sections', () => {
      expect(html).not.toContain('career-mobile-tariffs');
      expect(html).not.toContain('career-account-trigger');
      const navStart = html.indexOf('<nav class="career-mobile-nav"');
      const mobileNav = html.slice(navStart, html.indexOf('</nav>', navStart));
      expect(mobileNav).toContain('aria-label="Разделы"');
      expect(mobileNav.match(/class="career-nav-button/gu)).toHaveLength(4);
      expect(mobileNav).toContain('career-mobile-more-button');
      expect(mobileNav).toContain('Ещё');
    });

    it('centres the screen title between notification and consultant controls', () => {
      const html = renderToStaticMarkup(
        <CareerMobileTopbar
          activeView="today"
          title="Сегодня"
          pendingProposalCount={3}
          onOpenConsultant={() => undefined}
          notificationsSlot={<button type="button" aria-label="Уведомления: 3 новых" />}
        />,
      );

      expect(html).toContain('career-mobile-topbar-notifications');
      expect(html).toContain('<h1 class="career-mobile-page-title">Сегодня</h1>');
      expect(html).toContain('career-mobile-consultant-trigger');
      expect(html).toContain('career-mobile-consultant-dot');
      expect(html.indexOf('career-mobile-topbar-notifications')).toBeLessThan(
        html.indexOf('career-mobile-page-title'),
      );
      expect(html.indexOf('career-mobile-page-title')).toBeLessThan(
        html.indexOf('career-mobile-consultant-trigger'),
      );
    });

    it('styles the administrator link with a class, not a blocked attribute', () => {
      const adminHtml = renderToStaticMarkup(
        <CareerWorkspaceShell
          session={{ ...candidateSession, role: 'admin' }}
          workspace={workspace}
        />,
      );
      expect(adminHtml).toContain('Админка');
      expect(adminHtml).toContain('career-rail-admin');
      expect(adminHtml).not.toContain('style="');
    });

    it('names the vacancy section consistently without using Шансы', () => {
      expect(html).toContain('Вакансии');
      expect(html).not.toContain('Шансы');
    });
  });
});

describe('B440 fixed rail contract', () => {
  const candidateSession = {
    username: 'alexey',
    email: 'alexey@example.com',
    displayName: 'Мария Иванова',
    role: 'candidate' as const,
    isTest: false,
    candidateId: 'candidate-1',
  };
  const workspace = prepareCareerWorkspace({
    resumeText: 'Синтетический профиль кандидата.',
    resumeSource: 'text',
    targetDirection: 'Руководитель продукта',
    regions: ['ru'],
    currentSituation: 'Проверяю фиксированную оболочку.',
    constraints: '',
    urgency: 'active',
  });

  function shellHtml(initialView: ShellSection = 'today') {
    return renderToStaticMarkup(
      <CareerWorkspaceShell
        session={candidateSession}
        workspace={workspace}
        initialView={initialView}
      />,
    );
  }

  it('routes the dedicated Automation rail entry to the existing automation workspace', () => {
    const html = shellHtml();
    const automationHtml = shellHtml('automation');
    const rail = automationHtml.slice(
      automationHtml.indexOf('<aside id="career-rail"'),
      automationHtml.indexOf('</aside>'),
    );
    expect(html).not.toContain('career-responses-automation-switch');
    expect(rail).toMatch(
      /<button class="career-nav-button(?: is-active)?"[^>]*aria-label="Отклики"/u,
    );
    expect(rail.match(/aria-label="Автоматизация"/gu)).toHaveLength(1);
    expect(rail).toMatch(
      /<button class="career-nav-button is-active"[^>]*aria-label="Автоматизация"/u,
    );
    expect(automationHtml).toContain('data-shell-view="automation"');
    expect(automationHtml).toContain('class="automation-screen"');
  });

  it('has no rail expansion state and keeps tariff access on Wallet', () => {
    const html = shellHtml('tariffs');
    const rail = html.slice(html.indexOf('<aside id="career-rail"'), html.indexOf('</aside>'));
    expect(html).not.toContain('data-rail=');
    expect(rail).not.toContain('career-rail-toggle');
    expect(rail).not.toContain('career-rail-plan');
    expect(rail).toContain('career-rail-wallet is-active');
  });
});

describe('B440 — fixed shell and first-read skeleton', () => {
  const session = {
    username: 'candidate',
    email: 'candidate@example.com',
    displayName: 'Мария Иванова',
    role: 'candidate' as const,
    isTest: false,
    candidateId: 'candidate-b440',
  };

  it('keeps the 76px rail fixed and puts Wallet and account at its bottom', () => {
    const html = renderToStaticMarkup(<CareerWorkspaceShell session={session} />);
    const rail = html.slice(html.indexOf('<aside id="career-rail"'), html.indexOf('</aside>'));

    expect(rail).toContain('career-rail-wallet');
    expect(rail).toContain('career-account-button');
    expect(rail).not.toContain('career-rail-toggle');
    expect(rail).not.toContain('Тарифы. План');
    expect(rail).not.toContain('candidate@example.com');
  });

  it('uses four mobile sections plus an accessible More control', () => {
    const html = renderToStaticMarkup(<CareerWorkspaceShell session={session} />);
    const navStart = html.indexOf('<nav class="career-mobile-nav"');
    const mobileNav = html.slice(navStart, html.indexOf('</nav>', navStart));

    expect(mobileNav.match(/class="career-nav-button/gu)).toHaveLength(4);
    expect(mobileNav).toContain('career-mobile-more-button');
    expect(mobileNav).toContain('Ещё');
  });

  it('shows the Today skeleton and explains the profile read while session data is pending', () => {
    const html = renderToStaticMarkup(<CareerWorkspaceShell sessionPending />);

    expect(html).toContain('career-today-skeleton');
    expect(html).toContain('Проверяем вход и читаем ваш профиль');
  });

  it('shows a clear server error with a working retry action', () => {
    const html = renderToStaticMarkup(
      <CareerWorkspaceShell sessionPending sessionError="network_error" />,
    );

    expect(html).toContain('Ошибка: сервер не ответил');
    expect(html).toContain('Повторить');
  });
});
