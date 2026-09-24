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

  it('marks «Подборка» done once the pool actually holds a matched vacancy', () => {
    const steps = buildPathIndicator({
      track: [
        { id: 'campaign', label: 'Кампания поиска', status: 'active', reason: 'Готовим первое действие' },
      ],
      matchedPoolCount: 3,
      confirmedApplications: 0,
    });

    expect(steps.find((step) => step.id === 'shortlist')).toMatchObject({ state: 'done' });
  });

  it('marks «Подборка» in progress when a campaign is active but the pool is still empty', () => {
    const steps = buildPathIndicator({
      track: [
        { id: 'campaign', label: 'Кампания поиска', status: 'active', reason: 'Готовим первое действие' },
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

  it('marks «Отклики» in progress — «вы здесь» — while the board has a live pipeline', () => {
    const steps = buildPathIndicator({
      matchedPoolCount: 3,
      confirmedApplications: 0,
      activeResponses: 9,
    });

    expect(steps.find((step) => step.id === 'responses')).toMatchObject({
      state: 'in-progress',
      reason: '9 в работе — вы здесь',
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
    const destinations = new Set(steps.map((step) => step.destination));

    for (const destination of destinations) {
      expect(['profile', 'career', 'opportunities']).toContain(destination);
    }
  });
});
