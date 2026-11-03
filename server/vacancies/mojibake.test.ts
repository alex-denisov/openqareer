import { describe, expect, it } from 'vitest';
import { normalizeJsonSource } from './jsonSourceAdapters';
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

describe('src-remoteok text', () => {
  it('repairs the UTF-8-as-Latin-1 text RemoteOK sends (03.11)', () => {
    const [vacancy] = normalizeJsonSource(
      'src-remoteok',
      [
        { legal: 'API Terms of Service' },
        {
          id: '1137572',
          position: 'Senior Software Engineer LATAM',
          company: 'Wagmo',
          description:
            '<p><strong>Whatâ\u0080\u0099s Important To Us</strong></p><div>Â\u00a0</div>',
          location: '',
          url: 'https://remoteOK.com/remote-jobs/1137572',
          tags: [],
          date: '2026-10-26T08:00:06Z',
        },
      ],
      { observedAt: '2026-11-03T00:00:00.000Z' },
    );
    expect(vacancy?.description).not.toMatch(/â|Â/u);
    expect(vacancy?.description).toContain('What’s Important To Us');
  });
});
