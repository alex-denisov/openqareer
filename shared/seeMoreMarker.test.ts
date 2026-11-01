import { describe, expect, it } from 'vitest';
import { withoutSeeMoreMarker } from './seeMoreMarker';

describe('withoutSeeMoreMarker (01.11)', () => {
  it.each([
    ['Graduated with honors.... more', 'Graduated with honors.'],
    ['Graduated with honors…more', 'Graduated with honors…'],
    ['Led the team... see more', 'Led the team…'],
    ['Руководил командой… ещё', 'Руководил командой…'],
  ])('%s → %s', (input, expected) => {
    expect(withoutSeeMoreMarker(input)).toBe(expected);
  });

  it('keeps a text whose last word is just «more»', () => {
    expect(withoutSeeMoreMarker('We need more')).toBe('We need more');
  });

  it('collapses a run of dots into one ellipsis', () => {
    expect(withoutSeeMoreMarker('Итоги.... и планы')).toBe('Итоги… и планы');
  });
});
