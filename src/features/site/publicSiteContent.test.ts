import { describe, expect, it } from 'vitest';
import { FAQ_GROUPS } from './publicSiteContent';

describe('FAQ links', () => {
  it('every link text occurs in its answer, so the link is actually rendered', () => {
    const missing = FAQ_GROUPS.flatMap((group) => group.items).flatMap((item) =>
      (item.links ?? [])
        .filter((link) => !item.answer.includes(link.text))
        .map((link) => `${item.id}: ${link.text}`),
    );
    expect(missing).toEqual([]);
  });
});
