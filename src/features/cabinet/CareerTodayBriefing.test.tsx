import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerTodayBriefing } from './CareerTodayBriefing';

/**
 * B160 §3 — the resume import takes ~12 seconds in production. For all of it
 * «Сегодня» printed `0 · нет подтверждённых фактов`, a confident claim about a
 * server reading taken before the facts existed.
 */
function render(importing: boolean) {
  return renderToStaticMarkup(
    <CareerTodayBriefing
      name="Тестовый Кандидат"
      loading={false}
      importing={importing}
      onNavigate={() => undefined}
      onOpenExpert={() => undefined}
    />,
  );
}

describe('«Сегодня» while an import is still running', () => {
  it('stops claiming an empty profile it cannot yet know', () => {
    const html = render(true);

    expect(html).not.toContain('нет подтверждённых фактов');
    expect(html).toContain('идёт импорт');
  });

  it('states the honest zero again once the import has settled', () => {
    const html = render(false);

    expect(html).toContain('нет подтверждённых фактов');
    expect(html).not.toContain('идёт импорт');
  });
});
