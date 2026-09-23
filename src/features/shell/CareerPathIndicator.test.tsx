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
    expect(html).toContain('Резюме не загружено');
  });

  it('marks a finished step "done" and drops its reason line', () => {
    const steps = buildPathIndicator({ matchedPoolCount: 1, confirmedApplications: 1 });
    const html = renderToStaticMarkup(
      <CareerPathIndicator steps={steps} onNavigate={() => undefined} />,
    );

    expect(html).toContain('data-state="done"');
    expect(html).not.toContain('Откликов нет');
  });
});
