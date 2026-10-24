import { describe, expect, it } from 'vitest';
import { decodeVacancyText } from './vacancyText';

describe('decodeVacancyText', () => {
  it('decodes named, numeric and double-encoded entities', () => {
    expect(decodeVacancyText('Oregon Tilth&rsquo;s R&amp;D&nbsp;team')).toBe(
      'Oregon Tilth’s R&D team',
    );
    expect(decodeVacancyText('&#8212; &#x2019; &amp;rsquo;')).toBe('— ’ ’');
  });

  it('leaves unknown entities and plain text alone', () => {
    expect(decodeVacancyText('a &foo; b & c')).toBe('a &foo; b & c');
  });

  it('decodes accented Latin letters from French and German postings', () => {
    expect(decodeVacancyText('tr&egrave;s &Eacute;quipe gar&ccedil;on M&uuml;nchen &szlig; na&iuml;ve &ntilde;')).toBe(
      'très Équipe garçon München ß naïve ñ',
    );
    expect(decodeVacancyText('au c&oelig;ur, &OElig;uvre')).toBe('au cœur, Œuvre');
  });
});
