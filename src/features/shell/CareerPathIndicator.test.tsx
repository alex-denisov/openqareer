import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerPathIndicator } from './CareerPathIndicator';
import { buildPathIndicator } from './pathIndicator';

describe('CareerPathIndicator', () => {
  it('renders the five steps in order with an honest reason on each unfinished one', () => {
    const steps = buildPathIndicator({ matchedPoolCount: 0, confirmedApplications: 0 });
    const html = renderToStaticMarkup(
      <CareerPathIndicator steps={steps} onNavigate={() => undefined} />,
    );

    expect(html).toContain('Профиль');
    expect(html).toContain('Роль');
    expect(html).toContain('Подборка');
    expect(html).toContain('Отклики');
    expect(html).toContain('Интервью');
    expect(html.match(/career-path-step/gu)?.length).toBe(5);
    expect(html).toContain('Нет данных');
  });

  it('marks a finished step "done" and drops its reason line', () => {
    const steps = buildPathIndicator({ matchedPoolCount: 1, confirmedApplications: 1 });
    const html = renderToStaticMarkup(
      <CareerPathIndicator steps={steps} onNavigate={() => undefined} />,
    );

    expect(html).toContain('data-state="done"');
    expect(html).not.toContain('Откликов нет');
  });

  it('keeps only the current step in the compact mobile summary', () => {
    const steps = buildPathIndicator({
      matchedPoolCount: 2,
      confirmedApplications: 0,
    });
    const html = renderToStaticMarkup(
      <CareerPathIndicator steps={steps} onNavigate={() => undefined} />,
    );

    expect(html).toContain('career-path-mobile-summary');
    expect(html).toContain('Шаг 3 из 5');
    expect(html).toContain('Подборка');
    expect(html).toContain('2 в подборке');
  });

  it('highlights the open section with data-state="active" on campaign screen', () => {
    const steps = buildPathIndicator({
      matchedPoolCount: 2,
      confirmedApplications: 0,
      activeSection: 'career',
    });
    const html = renderToStaticMarkup(
      <CareerPathIndicator steps={steps} onNavigate={() => undefined} />,
    );

    const activeMatches = html.match(/data-state="active"/gu);
    expect(activeMatches?.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('career-path-step" data-state="active"');
  });

  it('has 0 active steps on «Сегодня» screen', () => {
    const steps = buildPathIndicator({
      matchedPoolCount: 2,
      confirmedApplications: 0,
      activeSection: 'today',
    });
    const html = renderToStaticMarkup(
      <CareerPathIndicator steps={steps} onNavigate={() => undefined} />,
    );

    expect(html).not.toContain('career-path-step" data-state="active"');
  });

  it('D9: ни одна подпись статуса не длиннее 14 символов', () => {
    const testCases = [
      { matchedPoolCount: 0, confirmedApplications: 0 },
      { matchedPoolCount: 15, confirmedApplications: 0, activeSection: 'opportunities' },
      { matchedPoolCount: 0, confirmedApplications: 1, activeResponses: 3 },
      {
        matchedPoolCount: 5,
        confirmedApplications: 0,
        nearestInterview: { company: 'SuperLongCompanyNameThatExceedsLimit', scheduledAt: '2026-10-01T10:00:00Z' },
      },
      {
        track: [
          { id: 'career-picture', label: 'Карьерная картина', status: 'active', reason: 'Собираем опыт, предпочтения и ограничения.' },
          { id: 'role-market', label: 'Роль и рынок', status: 'waiting', reason: 'Сверяем роль со свежей выборкой рынка.' },
        ],
        matchedPoolCount: 0,
        confirmedApplications: 0,
      },
    ] as const;

    for (const input of testCases) {
      const steps = buildPathIndicator(input);
      for (const step of steps) {
        expect(step.reason.length).toBeLessThanOrEqual(14);
      }
    }
  });
});

