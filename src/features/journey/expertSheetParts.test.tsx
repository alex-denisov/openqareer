import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExpertHistoryRow, ExpertVisibleLine } from './expertSheetParts';

describe('ExpertHistoryRow (A2)', () => {
  it('is one line: date, section and the first question, not the summary', () => {
    const html = renderToStaticMarkup(
      <ExpertHistoryRow
        dateTime="2026-10-28T10:00:00Z"
        dateLabel="28 окт"
        sectionTitle="Сегодня"
        firstPhrase="Почему именно это решение на сегодня?"
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain('28 окт');
    expect(html).toContain('Сегодня');
    expect(html).toContain('Почему именно это решение на сегодня?');
    expect(html).toContain('consultant-history-row');
    expect(html).not.toContain('Что выяснили');
  });
});

describe('ExpertVisibleLine (A3)', () => {
  it('names the context that goes with the turn', () => {
    const html = renderToStaticMarkup(<ExpertVisibleLine hasMarketQuery={false} />);
    expect(html).toContain('Видит: профиль, условия поиска');
  });
});
