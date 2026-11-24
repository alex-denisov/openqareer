import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from '../../resume/resumeTypes';
import { linksFull, normalizeLink, withLink } from './addLinkModel';

const draft = (links?: string[]): ResumeDraft =>
  ({ candidate: links ? { contact: { links } } : {}, experience: [] }) as unknown as ResumeDraft;
const YT = 'https://www.youtube.com/@name';

describe('B668: ссылка в «Данные для поиска»', () => {
  it('адрес приводится к полному виду, не адрес не берём', () => {
    expect(normalizeLink(' www.youtube.com/@name ')).toBe(YT);
    expect(normalizeLink('кандидат.рф/я')).toMatch(/^https:\/\/xn--/u);
    for (const raw of [
      '',
      '@name',
      'просто текст',
      'ftp://a.ru',
      'javascript:alert(1)',
      'https://127.0.0.1/a',
      'https://u:p@a.ru',
    ])
      expect(normalizeLink(raw)).toBeNull();
  });

  it('ссылка встаёт последней, повтор и двадцать первая ничего не меняют', () => {
    expect(withLink(draft(), YT).candidate.contact?.links).toEqual([YT]);
    expect(withLink(draft(['a.ru']), YT).candidate.contact?.links).toEqual(['a.ru', YT]);
    const same = draft(['www.youtube.com/@name/']);
    expect(withLink(same, YT)).toBe(same);
    const full = draft(Array.from({ length: 20 }, (_, index) => `a${index}.ru`));
    expect(withLink(full, YT)).toBe(full);
    expect(linksFull(full, YT)).toBe(true);
    expect(linksFull(same, YT)).toBe(false);
  });
});
