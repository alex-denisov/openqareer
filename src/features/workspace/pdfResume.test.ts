import { describe, expect, it } from 'vitest';
import { normalizeExtractedPageText } from './pdfResume';

describe('normalizeExtractedPageText', () => {
  it('keeps readable order and removes repeated whitespace', () => {
    expect(
      normalizeExtractedPageText([
        { str: 'Руководитель' },
        { str: '   продукта ' },
        { str: '' },
        { str: 'Запускал  новые   направления.' },
      ]),
    ).toBe('Руководитель продукта Запускал новые направления.');
  });

  it('ignores non-text PDF items', () => {
    expect(normalizeExtractedPageText([{ type: 'marked-content' }])).toBe('');
  });

  it('preserves explicit PDF line endings for later evidence review', () => {
    expect(
      normalizeExtractedPageText([
        { str: 'Опыт', hasEOL: true },
        { str: 'Запустил продукт.', hasEOL: true },
        { str: 'Навыки' },
      ]),
    ).toBe('Опыт\nЗапустил продукт.\nНавыки');
  });
});
