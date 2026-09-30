import { describe, expect, it } from 'vitest';
import { buildPathIndicator } from './pathIndicator';

describe('buildPathIndicator', () => {
  it('marks every step not started when there is no journey and no data at all', () => {
    const steps = buildPathIndicator({ matchedPoolCount: 0, confirmedApplications: 0 });

    expect(steps.map((step) => step.state)).toEqual([
      'not-started',
      'not-started',
      'not-started',
      'not-started',
      'not-started',
    ]);
    expect(steps.find((step) => step.id === 'profile')?.reason).toBe('Резюме не загружено');
    // Интервью has no data source in the product yet — it stays neutral
    // rather than borrowing another step's state.
    expect(steps.find((step) => step.id === 'interviews')?.reason).toBe('Интервью не назначено');
  });

  it('reads «Профиль» and «Роль» from the journey track', () => {
    const steps = buildPathIndicator({
      track: [
        { id: 'career-picture', label: 'Карьерная картина', status: 'complete', reason: 'Готово' },
        { id: 'role-market', label: 'Роль и рынок', status: 'active', reason: 'Проверяем рынок' },
        { id: 'positioning', label: 'Позиционирование', status: 'waiting', reason: '' },
        { id: 'campaign', label: 'Кампания поиска', status: 'waiting', reason: 'Не запущена' },
      ],
      matchedPoolCount: 0,
      confirmedApplications: 0,
    });

    expect(steps.find((step) => step.id === 'profile')).toMatchObject({
      state: 'done',
      reason: 'Готово',
    });
    expect(steps.find((step) => step.id === 'role')).toMatchObject({
      state: 'in-progress',
      reason: 'Проверяем рынок',
    });
  });

  it('marks «Подборка» in progress («вы здесь») while the pool has matches and nothing is confirmed yet', () => {
    const steps = buildPathIndicator({
      track: [
        {
          id: 'campaign',
          label: 'Кампания поиска',
          status: 'active',
          reason: 'Готовим первое действие',
        },
      ],
      matchedPoolCount: 3,
      confirmedApplications: 0,
    });

    expect(steps.find((step) => step.id === 'shortlist')).toMatchObject({
      state: 'in-progress',
      reason: '3 в подборке',
    });
  });

  it('marks «Подборка» done once the candidate has moved on to a confirmed application', () => {
    const steps = buildPathIndicator({
      track: [
        {
          id: 'campaign',
          label: 'Кампания поиска',
          status: 'active',
          reason: 'Готовим первое действие',
        },
      ],
      matchedPoolCount: 3,
      confirmedApplications: 1,
    });

    expect(steps.find((step) => step.id === 'shortlist')).toMatchObject({ state: 'done' });
  });

  it('marks «Подборка» in progress when a campaign is active but the pool is still empty', () => {
    const steps = buildPathIndicator({
      track: [
        {
          id: 'campaign',
          label: 'Кампания поиска',
          status: 'active',
          reason: 'Готовим первое действие',
        },
      ],
      matchedPoolCount: 0,
      confirmedApplications: 0,
    });

    expect(steps.find((step) => step.id === 'shortlist')).toMatchObject({ state: 'in-progress' });
  });

  it('marks «Отклики» done only once an application is confirmed', () => {
    const steps = buildPathIndicator({ matchedPoolCount: 0, confirmedApplications: 1 });

    expect(steps.find((step) => step.id === 'responses')).toMatchObject({ state: 'done' });
  });

  it('never marks two steps «в процессе» at once, even when both sources are active', () => {
    // «Роль» ещё активна в движке, и пул уже непустой — оба источника честно
    // говорят «в процессе» сами по себе; кандидат физически на одном шаге.
    const steps = buildPathIndicator({
      track: [
        { id: 'career-picture', label: 'Карьерная картина', status: 'complete', reason: 'Готово' },
        { id: 'role-market', label: 'Роль и рынок', status: 'active', reason: 'Проверяем рынок' },
      ],
      matchedPoolCount: 5,
      confirmedApplications: 0,
    });

    const inProgress = steps.filter((step) => step.state === 'in-progress');
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]?.id).toBe('role');
    expect(steps.find((step) => step.id === 'shortlist')).toMatchObject({ state: 'not-started' });
  });

  it('marks «Отклики» in progress — «вы здесь» — while the board has a live pipeline', () => {
    const steps = buildPathIndicator({
      matchedPoolCount: 3,
      confirmedApplications: 0,
      activeResponses: 9,
    });

    expect(steps.find((step) => step.id === 'responses')).toMatchObject({
      state: 'in-progress',
      reason: '9 в работе',
    });
  });

  it('marks «Интервью» in progress with the nearest interview once the tracker has one', () => {
    const steps = buildPathIndicator({
      matchedPoolCount: 3,
      confirmedApplications: 0,
      activeResponses: 9,
      nearestInterview: { company: 'HRTx, Inc.', scheduledAt: '2026-09-26T14:00:00.000Z' },
    });

    expect(steps.find((step) => step.id === 'interviews')).toMatchObject({ state: 'in-progress' });
    expect(steps.find((step) => step.id === 'interviews')?.reason).toContain('HRTx, Inc.');
  });

  it('points every step at an existing screen, never a placeholder route', () => {
    const steps = buildPathIndicator({ matchedPoolCount: 0, confirmedApplications: 0 });
    expect(steps.map(({ id, destination }) => [id, destination])).toEqual([
      ['profile', 'profile'],
      ['role', 'career'],
      ['shortlist', 'opportunities'],
      ['responses', 'responses'],
      ['interviews', 'responses'],
    ]);
  });

  describe('C73: current step matches the open section', () => {
    it('sets step «Профиль» as current on profile screen', () => {
      const steps = buildPathIndicator({
        matchedPoolCount: 0,
        confirmedApplications: 0,
        activeSection: 'profile',
      });
      const current = steps.filter((step) => step.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0]?.id).toBe('profile');
    });

    it('sets step «Роль» as current on career screen, even if role is already done', () => {
      const steps = buildPathIndicator({
        track: [
          { id: 'career-picture', label: 'Карьерная картина', status: 'complete', reason: 'Готово' },
          { id: 'role-market', label: 'Роль и рынок', status: 'complete', reason: 'Готово' },
        ],
        matchedPoolCount: 5,
        confirmedApplications: 0,
        activeSection: 'career',
      });
      const current = steps.filter((step) => step.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0]?.id).toBe('role');
      expect(current[0]?.state).toBe('done');
    });

    it('sets step «Подборка» as current on opportunities screen', () => {
      const steps = buildPathIndicator({
        matchedPoolCount: 3,
        confirmedApplications: 0,
        activeSection: 'opportunities',
      });
      const current = steps.filter((step) => step.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0]?.id).toBe('shortlist');
    });

    it('sets step «Отклики» as current on responses screen when there are no interview stages', () => {
      const steps = buildPathIndicator({
        matchedPoolCount: 3,
        confirmedApplications: 1,
        activeResponses: 2,
        activeSection: 'responses',
      });
      const current = steps.filter((step) => step.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0]?.id).toBe('responses');
    });

    it('sets step «Интервью» as current on responses screen when there are interview stages', () => {
      const steps = buildPathIndicator({
        matchedPoolCount: 3,
        confirmedApplications: 1,
        activeResponses: 2,
        hasInterviewStage: true,
        activeSection: 'responses',
      });
      const current = steps.filter((step) => step.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0]?.id).toBe('interviews');
    });

    it('has zero current steps on «Сегодня» screen, keeping completion statuses separate', () => {
      const steps = buildPathIndicator({
        track: [
          { id: 'career-picture', label: 'Карьерная картина', status: 'complete', reason: 'Готово' },
          { id: 'role-market', label: 'Роль и рынок', status: 'active', reason: 'Проверяем рынок' },
        ],
        matchedPoolCount: 0,
        confirmedApplications: 0,
        activeSection: 'today',
      });
      const current = steps.filter((step) => step.isCurrent);
      expect(current).toHaveLength(0);
      expect(steps.find((step) => step.id === 'profile')?.state).toBe('done');
      expect(steps.find((step) => step.id === 'role')?.state).toBe('in-progress');
    });

    it('ensures exactly one current step on every campaign screen', () => {
      const campaignSections = ['profile', 'career', 'opportunities', 'responses'] as const;
      for (const section of campaignSections) {
        const steps = buildPathIndicator({
          matchedPoolCount: 1,
          confirmedApplications: 0,
          activeSection: section,
        });
        const current = steps.filter((step) => step.isCurrent);
        expect(current).toHaveLength(1);
      }
    });
  });
});

