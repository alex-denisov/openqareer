import { describe, expect, it } from 'vitest';
import { repairMojibake } from './mojibake';

// Real RemoteOK API text, 03.11 (job 1137572 and neighbours): UTF-8 bytes
// delivered as Latin-1 characters.
describe('repairMojibake', () => {
  it('restores apostrophes, dashes, no-break spaces and symbols', () => {
    expect(repairMojibake('Whatâ\u0080\u0099s Important To Us')).toBe('What’s Important To Us');
    expect(repairMojibake('$185Kâ\u0080\u0093$215K base')).toBe('$185K–$215K base');
    expect(repairMojibake('<div>Â </div>')).toBe('<div> </div>');
    expect(repairMojibake('Â£134,600 GBP')).toBe('£134,600 GBP');
    expect(repairMojibake('GartnerÂ® Magic Quadrantâ\u0084¢')).toBe('Gartner® Magic Quadrant™');
    expect(repairMojibake('desde LATAM, Â¡queremos conocerte!')).toBe(
      'desde LATAM, ¡queremos conocerte!',
    );
  });

  it('leaves correctly decoded text alone', () => {
    for (const text of [
      'Café — naïve façade',
      'Zürich, Ørsted, São Paulo',
      'Москва, «вакансия»',
      'What’s new',
    ]) {
      expect(repairMojibake(text)).toBe(text);
    }
  });
});
