// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsesBoard } from './ResponsesBoard';
import type { ApplicationView } from './applicationsApi';
import type { UseApplications } from './useApplications';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function application(overrides: Partial<ApplicationView>): ApplicationView {
  return {
    id: 'a1',
    candidateId: 'c1',
    clusterId: 'cl1',
    stage: 'applied',
    closedReason: null,
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
    scheduleInterview: async () => {},
    retryStageChange: () => {},
    markFollowUpSent: async () => {},
    saveNote: () => {},
    addManualCard: async (input) =>
      application({ clusterId: input.clusterId ?? null, stage: input.stage }),
    skip: async () => {},
  };
}

describe('ResponsesBoard columns', () => {
  it('groups applications into the six mockup columns with counts', () => {
    const applications = [
      application({ id: 'a1', stage: 'saved' }),
      application({ id: 'a2', stage: 'applied' }),
      application({ id: 'a3', stage: 'responded' }),
      application({ id: 'a4', stage: 'interview' }),
      application({ id: 'a5', stage: 'rejected' }),
      application({ id: 'a6', stage: 'archived' }),
    ];
    const html = renderToStaticMarkup(
      <ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />,
    );

    ['Хочу', 'Откликнулся', 'Ответ', 'Интервью', 'Оффер', 'Отказ / Архив'].forEach((label) => {
      expect(html).toContain(label);
    });
    // The offer column has no cards and shows a zero count.
    const offerHead = html.indexOf('<h2>Оффер</h2>');
    expect(html.slice(offerHead, offerHead + 100)).toMatch(/>0</);
    // Rejected and archived share the sixth column.
    const closedHead = html.indexOf('<h2>Отказ / Архив</h2>');
    expect(html.slice(closedHead, closedHead + 100)).toMatch(/>2</);
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
    expect(html).toContain('Откликов пока нет');
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

  it('открывает меню карточки по клику на тело карточки', () => {
    act(() => {
      root.render(<ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />);
    });

    expect(container.querySelectorAll('.career-responses-card-menu').length).toBe(0);

    const firstCard = container.querySelectorAll('.career-responses-card')[0] as HTMLElement;
    const roleTitle = firstCard.querySelector('.career-responses-card-role') as HTMLElement;

    act(() => {
      roleTitle.click();
    });

    expect(firstCard.querySelectorAll('.career-responses-card-menu').length).toBe(1);
  });

  it('закрывает открытое меню по нажатию Escape', () => {
    act(() => {
      root.render(<ResponsesBoard state={readyState(applications)} onOpenVacancies={() => {}} />);
    });

    const firstCard = container.querySelectorAll('.career-responses-card')[0] as HTMLElement;
    const roleTitle = firstCard.querySelector('.career-responses-card-role') as HTMLElement;

    act(() => {
      roleTitle.click();
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
    const roleTitle = firstCard.querySelector('.career-responses-card-role') as HTMLElement;

    act(() => {
      roleTitle.click();
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
    const firstRole = cards[0].querySelector('.career-responses-card-role') as HTMLElement;
    const secondRole = cards[1].querySelector('.career-responses-card-role') as HTMLElement;

    act(() => {
      firstRole.click();
    });
    expect(cards[0].querySelectorAll('.career-responses-card-menu').length).toBe(1);
    expect(cards[1].querySelectorAll('.career-responses-card-menu').length).toBe(0);

    act(() => {
      secondRole.click();
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
      expect(allHeaders.length).toBe(6);
    });

    it('показывает пустое состояние «Интервью пока не назначены», если откликов на этапе интервью нет', () => {
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

      expect(container.textContent).toContain('Интервью пока не назначены');
      const resetBtn = container.querySelector('button') as HTMLButtonElement;
      expect(resetBtn.textContent).toContain('Открыть все отклики');

      act(() => {
        resetBtn.click();
      });

      expect(container.textContent).not.toContain('Интервью пока не назначены');
      expect(container.textContent).toContain('Applied Role');
    });
  });

  it('вызывает onOpenExpert с этапом responses и subject отклика при клике «Обсудить с консультантом»', () => {
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

    const firstCard = container.querySelectorAll('.career-responses-card')[0] as HTMLElement;
    const roleTitle = firstCard.querySelector('.career-responses-card-role') as HTMLElement;

    act(() => {
      roleTitle.click();
    });

    const discussBtn = Array.from(firstCard.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Обсудить с консультантом'),
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

  it('в карточке с этапом interview кнопка Подготовиться открывает модалку с кнопкой Спросить консультанта', () => {
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

    const prepBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Подготовиться'),
    );
    expect(prepBtn).toBeDefined();

    act(() => {
      prepBtn?.click();
    });

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
