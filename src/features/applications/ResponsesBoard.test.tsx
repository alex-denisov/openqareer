// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsesBoard } from './ResponsesBoard';
import type { ApplicationListPageMeta, ApplicationView } from './applicationsApi';
import type { UseApplications } from './useApplications';

// Фикстуры датированы сентябрём–октябрём 2026: окно «30 дней» считается от этой даты, а не от часов машины.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'));
});
afterAll(() => {
  vi.useRealTimers();
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function application(overrides: Partial<ApplicationView>): ApplicationView {
  return {
    id: 'a1',
    candidateId: 'c1',
    clusterId: 'cl1',
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      title: 'Senior Frontend Developer',
      company: 'FinCloud',
      url: 'https://x',
      source: 'hh',
    },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-20T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    archiveStaleDays: 30,
    ...overrides,
  };
}

function readyState(applications: readonly ApplicationView[]): UseApplications {
  return {
    status: 'ready',
    applications,
    offline: false,
    failedChanges: new Map(),
    conflicts: new Set(),
    reload: () => {},
    refreshApplications: async () => applications,
    changeStage: () => {},
    restoreFromArchive: async () => {},
    scheduleInterview: async () => {},
    retryStageChange: () => {},
    markFollowUpSent: async () => {},
    saveNote: () => {},
    addManualCard: async (input) =>
      application({ clusterId: input.clusterId ?? null, stage: input.stage }),
    skip: async () => {},
    saveOffer: async () => {},
  };
}

describe('ResponsesBoard columns', () => {
  it('groups saved and sent applications into four columns and keeps closed counts outside them', () => {
    const applications = [
      application({ id: 'a1', stage: 'saved' }),
      application({ id: 'a2', stage: 'applied' }),
      application({
        id: 'a2-delivered',
        stage: 'applied',
        deliveryReceipt: { kind: 'confirmation_url', value: 'https://jobs.test/receipt' },
      }),
      application({ id: 'a3', stage: 'responded' }),
      application({ id: 'a4', stage: 'interview' }),
      application({ id: 'a5', stage: 'rejected' }),
      application({ id: 'a6', stage: 'archived' }),
    ];
    const html = renderToStaticMarkup(
      <ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />,
    );

    ['Отправлено', 'Ответили', 'Интервью', 'Оффер'].forEach((label) => {
      expect(html).toContain('aria-label="' + label + '"');
    });
    expect(html).not.toContain('aria-label="Отказ"');
    expect(html).toContain('Нужно действие:');
    expect(html).toContain('Архив');
    expect(html).toContain('Доставка подтверждена');
    expect(html).not.toContain('https://jobs.test/receipt');
    expect(html).toContain('Пробовали отправить');
    expect(html).toContain('1');
  });

  it('renders card role, company and waiting label', () => {
    const applications = [
      application({
        id: 'a1',
        stage: 'applied',
        vacancy: {
          title: 'Enterprise Architect',
          company: 'Peraton',
          url: 'https://x',
          source: 'hh',
        },
        whoseTurn: 'company',
        materials: { coverLetter: true, resume: true },
      }),
    ];
    const html = renderToStaticMarkup(
      <ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />,
    );

    expect(html).toContain('Enterprise Architect');
    expect(html).toContain('Peraton');
    expect(html).toContain('career-responses-waiting');
  });

  it('renders the loading skeleton before data arrives', () => {
    const state: UseApplications = { ...readyState([]), status: 'loading' };
    const html = renderToStaticMarkup(<ResponsesBoard state={state} onOpenVacancies={() => {}} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Загружаем отклики');
  });

  it('renders the empty pipeline copy from the mockup', () => {
    const html = renderToStaticMarkup(
      <ResponsesBoard state={readyState([])} onOpenVacancies={() => {}} />,
    );
    expect(html).toContain('Откликов пока нет за выбранный период');
    expect(html).toContain('Здесь появится карточка каждого отклика');
    expect(html).toContain('Перейти к вакансиям');
    expect(html).toContain('Добавить отклик вручную');
  });

  it('renders an offline error without the raw message', () => {
    const state: UseApplications = {
      ...readyState([]),
      status: 'error',
      offline: true,
      error: 'Failed to fetch',
    };
    const html = renderToStaticMarkup(<ResponsesBoard state={state} onOpenVacancies={() => {}} />);
    expect(html).toContain('Нет соединения');
    expect(html).not.toContain('Failed to fetch');
  });

  it('renders a retry action for a non-offline load error', () => {
    const state: UseApplications = {
      ...readyState([]),
      status: 'error',
      offline: false,
      error: 'Не удалось загрузить отклики.',
    };
    const html = renderToStaticMarkup(<ResponsesBoard state={state} onOpenVacancies={() => {}} />);
    expect(html).toContain('Не удалось загрузить отклики.');
    expect(html).toContain('Повторить');
  });

  it('explains a conflicting edit and offers to refresh the card', () => {
    const state: UseApplications = {
      ...readyState([application({ id: 'a1' })]),
      conflicts: new Set(['a1']),
    };
    const html = renderToStaticMarkup(<ResponsesBoard state={state} onOpenVacancies={() => {}} />);

    expect(html).toContain('Карточку изменили в другом окне.');
    expect(html).toContain('Ваши изменения не сохранены.');
    expect(html).toContain('Обновить карточку');
  });

  it('renders a hidden-company card without leaking the name', () => {
    const applications = [
      application({
        id: 'a1',
        stage: 'saved',
        vacancy: {
          title: 'VP Technology',
          company: '',
          companyHidden: true,
          url: 'https://x',
          source: 'recruiter',
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />,
    );

    expect(html).toContain('VP Technology');
    expect(html).toContain('компания скрыта');
  });
});

describe('ResponsesBoard card menu interactions (B337)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const applications = [
    application({
      id: 'a1',
      stage: 'saved',
      vacancy: { title: 'First Role', company: 'Acme', url: 'https://x', source: 'hh' },
    }),
    application({
      id: 'a2',
      stage: 'saved',
      vacancy: { title: 'Second Role', company: 'Beta', url: 'https://y', source: 'hh' },
    }),
  ];

  it('выбирает отклик по клику на роль и показывает выбранную панель', () => {
    act(() => {
      root.render(<ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />);
    });

    expect(container.querySelectorAll('.career-responses-card-menu').length).toBe(0);

    const firstCard = container.querySelectorAll('.career-responses-card')[0] as HTMLElement;
    const roleTitle = firstCard.querySelector('.career-responses-card-role') as HTMLElement;

    act(() => {
      roleTitle.click();
    });

    expect(firstCard.classList.contains('is-selected')).toBe(true);
    expect(container.textContent).toContain('Выбранный отклик');
    expect(firstCard.querySelectorAll('.career-responses-card-menu').length).toBe(0);
  });

  it('закрывает открытое меню по нажатию Escape', () => {
    act(() => {
      root.render(<ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />);
    });

    const firstCard = container.querySelectorAll('.career-responses-card')[0] as HTMLElement;
    const menuButton = firstCard.querySelector(
      '.career-responses-menu-wrap > button',
    ) as HTMLButtonElement;

    act(() => {
      menuButton.click();
    });
    expect(firstCard.querySelectorAll('.career-responses-card-menu').length).toBe(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelectorAll('.career-responses-card-menu').length).toBe(0);
  });

  it('закрывает меню по клику снаружи карточки', () => {
    act(() => {
      root.render(<ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />);
    });

    const firstCard = container.querySelectorAll('.career-responses-card')[0] as HTMLElement;
    const menuButton = firstCard.querySelector(
      '.career-responses-menu-wrap > button',
    ) as HTMLButtonElement;

    act(() => {
      menuButton.click();
    });
    expect(firstCard.querySelectorAll('.career-responses-card-menu').length).toBe(1);

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(container.querySelectorAll('.career-responses-card-menu').length).toBe(0);
  });

  it('держит открытым ровно одно меню на доске: открытие второй карточки закрывает первую', () => {
    act(() => {
      root.render(<ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />);
    });

    const cards = container.querySelectorAll('.career-responses-card');
    const firstMenu = cards[0].querySelector(
      '.career-responses-menu-wrap > button',
    ) as HTMLButtonElement;
    const secondMenu = cards[1].querySelector(
      '.career-responses-menu-wrap > button',
    ) as HTMLButtonElement;

    act(() => {
      firstMenu.click();
    });
    expect(cards[0].querySelectorAll('.career-responses-card-menu').length).toBe(1);
    expect(cards[1].querySelectorAll('.career-responses-card-menu').length).toBe(0);

    act(() => {
      secondMenu.click();
    });
    expect(cards[0].querySelectorAll('.career-responses-card-menu').length).toBe(0);
    expect(cards[1].querySelectorAll('.career-responses-card-menu').length).toBe(1);
    expect(container.querySelectorAll('.career-responses-card-menu').length).toBe(1);
  });

  describe('D15: фильтрация колонки Интервью', () => {
    it('показывает только колонку Интервью и пометку «Показаны отклики на этапе «Интервью» · Показать все»', () => {
      const apps = [
        application({
          id: 'a1',
          stage: 'applied',
          vacancy: { title: 'Applied Role', company: 'Comp A', url: '', source: 'hh' },
        }),
        application({
          id: 'a2',
          stage: 'interview',
          vacancy: { title: 'Interview Role', company: 'Comp B', url: '', source: 'hh' },
        }),
      ];

      act(() => {
        root.render(
          <ResponsesBoard
            state={readyState(apps)}
            onOpenVacancies={() => {}}
            initialStageFilter="interview"
          />,
        );
      });

      expect(container.textContent).toContain('Показаны отклики на этапе «Интервью»');
      expect(container.textContent).toContain('Показать все');
      expect(container.textContent).toContain('Interview Role');
      expect(container.textContent).not.toContain('Applied Role');
      // Only interview column is rendered
      const columnHeaders = Array.from(
        container.querySelectorAll('.career-responses-column-head h2'),
      ).map((el) => el.textContent);
      expect(columnHeaders).toEqual(['Интервью']);

      // Клик по «Показать все» снимает фильтр
      const resetBtn = container.querySelector(
        '.career-responses-filter-reset',
      ) as HTMLButtonElement;
      act(() => {
        resetBtn.click();
      });

      expect(container.textContent).not.toContain('Показаны отклики на этапе «Интервью»');
      expect(container.textContent).toContain('Applied Role');
      const allHeaders = Array.from(
        container.querySelectorAll('.career-responses-column-head h2'),
      ).map((el) => el.textContent);
      expect(allHeaders).toEqual(['Отправлено', 'Ответили', 'Интервью', 'Оффер']);
    });

    it('показывает пустое состояние для фильтра интервью и позволяет сбросить фильтр', () => {
      const apps = [
        application({
          id: 'a1',
          stage: 'applied',
          vacancy: { title: 'Applied Role', company: 'Comp A', url: '', source: 'hh' },
        }),
      ];

      act(() => {
        root.render(
          <ResponsesBoard
            state={readyState(apps)}
            onOpenVacancies={() => {}}
            initialStageFilter="interview"
          />,
        );
      });

      expect(container.textContent).toContain('Отклики не найдены');
      const resetBtn = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Сбросить фильтры'),
      ) as HTMLButtonElement;
      expect(resetBtn.textContent).toContain('Сбросить фильтры');

      act(() => {
        resetBtn.click();
      });

      expect(container.textContent).not.toContain('Отклики не найдены');
      expect(container.textContent).toContain('Applied Role');
    });
  });

  it('вызывает консультанта по выбранному отклику', () => {
    const onOpenExpert = vi.fn();
    act(() => {
      root.render(
        <ResponsesBoard
          state={readyState(applications)}
          onOpenVacancies={() => {}}
          onOpenExpert={onOpenExpert}
        />,
      );
    });

    const discussBtn = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Обсудить',
    );
    expect(discussBtn).toBeDefined();

    act(() => {
      discussBtn?.click();
    });

    expect(onOpenExpert).toHaveBeenCalledWith(
      'responses',
      { kind: 'application', id: 'a1' },
      'О вакансии: First Role — Acme',
    );
  });

  it('из выбранного интервью можно открыть подготовку и спросить консультанта', () => {
    const onOpenExpert = vi.fn();
    const interviewApps = [
      application({
        id: 'a-int',
        stage: 'interview',
        vacancy: { title: 'Tech Lead', company: 'Yandex', url: 'https://x', source: 'hh' },
      }),
    ];

    act(() => {
      root.render(
        <ResponsesBoard
          state={readyState(interviewApps)}
          onOpenVacancies={() => {}}
          onOpenExpert={onOpenExpert}
        />,
      );
    });

    const prepBtn = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Начать мок-интервью'),
    );
    expect(prepBtn).toBeDefined();

    act(() => {
      prepBtn?.click();
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const askBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Спросить консультанта'),
    );
    expect(askBtn).toBeDefined();

    act(() => {
      askBtn?.click();
    });

    expect(onOpenExpert).toHaveBeenCalledWith(
      'interviews',
      { kind: 'application', id: 'a-int' },
      'О вакансии: Tech Lead — Yandex',
    );
  });
});

describe('ResponsesBoard view and channel analytics (B450)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('переключает колонки и таблицу и показывает результативность по каналам', () => {
    const apps = [
      application({ id: 'a1', stage: 'applied' }),
      application({ id: 'a2', stage: 'interview' }),
    ];

    act(() => {
      root.render(<ResponsesBoard state={readyState(apps)} onOpenVacancies={() => {}} />);
    });

    const tableBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Таблица'),
    );
    expect(tableBtn).toBeDefined();

    act(() => {
      tableBtn?.click();
    });

    expect(container.querySelector('.career-responses-table')).not.toBeNull();

    const columnsBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Колонки'),
    );
    expect(columnsBtn).toBeDefined();

    act(() => {
      columnsBtn?.click();
    });

    expect(container.querySelector('.career-responses-board')).not.toBeNull();
    expect(container.querySelector('.career-responses-channel-performance')).not.toBeNull();
    expect(container.textContent).toContain('Результативность по каналам');
    expect(container.textContent).toContain('Отклики, n');
  });
});

describe('ResponsesBoard B450 workspace navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('exposes the four approved sections and leaves automation in shell navigation', () => {
    act(() => {
      root.render(
        <ResponsesBoard
          state={readyState([application({ id: 'a1', stage: 'applied' })])}
          onOpenVacancies={() => {}}
        />,
      );
    });

    const labels = Array.from(container.querySelectorAll('button')).map(
      (button) => button.textContent?.trim() ?? '',
    );

    expect(labels.some((label) => label.startsWith('Воронка'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Хочу в компанию'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Подготовка'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Офферы'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Автоматизация'))).toBe(false);

    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const panelIds = new Set(
      Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]')).map(
        (panel) => panel.id,
      ),
    );
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).not.toBeNull();
      expect(panelIds.has(panelId ?? '')).toBe(true);
    }
  });

  it('retains the closed-response summary when no open response is visible', () => {
    const closed = application({
      id: 'closed-1',
      stage: 'archived',
      whoseTurn: null,
      archiveReason: 'stale',
    });
    act(() => {
      root.render(<ResponsesBoard state={readyState([closed])} onOpenVacancies={() => {}} />);
    });

    expect(container.querySelector('.career-responses-mobile-closed')).not.toBeNull();
    expect(container.textContent).toContain('Закрыто · 1');
  });

  it('uses model-backed next steps for saved applications and offers', () => {
    const apps = [
      application({
        id: 'saved-bare',
        stage: 'saved',
        whoseTurn: 'candidate',
        materials: { coverLetter: false, resume: false },
      }),
      application({ id: 'offer-decision', stage: 'offer', whoseTurn: 'candidate' }),
      application({
        id: 'due-follow-up',
        stage: 'applied',
        whoseTurn: 'candidate',
        followUp: {
          dueAt: '2026-10-14T00:00:00.000Z',
          urgency: 'due',
          source: 'standard_schedule',
          daysSinceContact: 1,
        },
      }),
      application({
        id: 'overdue-follow-up',
        stage: 'applied',
        whoseTurn: 'candidate',
        followUp: {
          dueAt: '2026-10-10T00:00:00.000Z',
          urgency: 'overdue',
          source: 'standard_schedule',
          daysSinceContact: 5,
        },
      }),
    ];
    act(() => {
      root.render(<ResponsesBoard state={readyState(apps)} onOpenVacancies={() => {}} />);
    });

    const actions = Array.from(container.querySelectorAll('.career-responses-mobile-row-next')).map(
      (button) => button.textContent?.trim(),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'Собрать письмо',
        'Решить по офферу',
        'Напомнить сегодня',
        'Напомнить рекрутеру',
      ]),
    );
    const manualSendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="career-responses-mobile-manual-send"]',
    );
    expect(manualSendButton).not.toBeNull();
    expect(
      container.querySelector('#career-responses-mobile-manual-send')?.hasAttribute('hidden'),
    ).toBe(true);
  });

  it('offers the columns and table views', () => {
    act(() => {
      root.render(
        <ResponsesBoard
          state={readyState([application({ id: 'a1', stage: 'applied' })])}
          onOpenVacancies={() => {}}
        />,
      );
    });

    const labels = Array.from(container.querySelectorAll('button')).map(
      (button) => button.textContent?.trim() ?? '',
    );

    expect(labels).toEqual(expect.arrayContaining(['Колонки', 'Таблица']));
  });

  it('filters loaded candidate data by channel and keeps the next step visible', async () => {
    const apps = [
      application({
        id: 'hh-1',
        stage: 'applied',
        vacancy: {
          title: 'Platform Engineer',
          company: 'Northstar',
          url: 'https://x',
          source: 'hh.ru',
        },
      }),
      application({
        id: 'li-1',
        stage: 'responded',
        vacancy: { title: 'Security Lead', company: 'Orion', url: 'https://x', source: 'linkedin' },
        whoseTurn: 'candidate',
        followUp: {
          dueAt: '2026-10-10T00:00:00.000Z',
          urgency: 'overdue',
          source: 'standard_schedule',
          daysSinceContact: 14,
        },
      }),
    ];
    const state = { ...readyState(apps), pageMeta: pageMeta(2) };
    act(() => root.render(<ResponsesBoard state={state} onOpenVacancies={() => {}} />));

    const channel = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Канал отклика"]',
    );
    expect(channel).not.toBeNull();
    act(() => {
      if (channel) {
        channel.value = 'linkedin';
        channel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(container.textContent).toContain('Security Lead');
    expect(container.textContent).not.toContain('Platform Engineer');
    expect(container.textContent).toContain('Напоминание компании просрочено');
  });
});

function pageMeta(total: number): ApplicationListPageMeta {
  return {
    total,
    offset: 0,
    limit: 20,
    stageCounts: {
      saved: 0,
      applied: total,
      responded: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
      archived: 0,
    },
  };
}

describe('ResponsesBoard deep link (B542 «Смотреть»)', () => {
  it('opens the card the Today changes strip pointed at', () => {
    const applications = [
      application({
        id: 'a1',
        vacancy: { title: 'CTO', company: 'FinCloud', url: 'https://x', source: 'hh' },
      }),
      application({
        id: 'a2',
        vacancy: {
          title: 'Head of Engineering',
          company: 'Вектор Банк',
          url: 'https://y',
          source: 'hh',
        },
      }),
    ];
    const html = renderToStaticMarkup(
      <ResponsesBoard
        state={readyState(applications)}
        onOpenVacancies={() => {}}
        initialApplicationId="a2"
      />,
    );
    const panel = html.slice(html.indexOf('career-responses-selected"'));
    expect(panel).toContain('Вектор Банк');
    expect(panel).not.toContain('FinCloud');
  });
});
