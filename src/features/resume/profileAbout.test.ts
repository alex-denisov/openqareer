import { describe, expect, it } from 'vitest';
import { parseAboutContent } from './profileAbout';

describe('parseAboutContent', () => {
  it('keeps a plain paragraph as one paragraph block', () => {
    const blocks = parseAboutContent('15 лет строю и масштабирую инженерные организации.');
    expect(blocks).toEqual([
      { type: 'paragraph', text: '15 лет строю и масштабирую инженерные организации.' },
    ]);
  });

  it('splits a heading paragraph and a following bullet list into separate blocks (owner remark #6)', () => {
    const about = 'Что делаю лучше всего:\n- Строю инженерную стратегию\n- Масштабирую команды';
    const blocks = parseAboutContent(about);
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Что делаю лучше всего:' },
      { type: 'list', items: ['Строю инженерную стратегию', 'Масштабирую команды'] },
    ]);
  });

  it('treats a blank line as a paragraph separator', () => {
    const about = 'Первый абзац.\n\nВторой абзац.';
    const blocks = parseAboutContent(about);
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Первый абзац.' },
      { type: 'paragraph', text: 'Второй абзац.' },
    ]);
  });

  it('recognizes • as a bullet marker too', () => {
    const blocks = parseAboutContent('• Первый пункт\n• Второй пункт');
    expect(blocks).toEqual([{ type: 'list', items: ['Первый пункт', 'Второй пункт'] }]);
  });

  it('never glues a bullet onto the previous line’s text', () => {
    const about = 'Что делаю лучше всего: - Строю инженерную стратегию и roadmap';
    const blocks = parseAboutContent(about);
    // A dash mid-line (not at line start) is not a bullet marker — this stays
    // one paragraph rather than becoming a false list, but it must not read
    // as the run-on "Что делаю: - Строю..." single sentence the bug produced.
    expect(blocks).toEqual([{ type: 'paragraph', text: about }]);
  });

  it('returns no blocks for empty input', () => {
    expect(parseAboutContent('')).toEqual([]);
  });
});
