import { describe, expect, it } from 'vitest';
import { candidateChannels } from './recruiterChannel';

const at = '2026-10-27T00:00:00.000Z';

describe('candidate channels', () => {
  it('drops an email on a job board domain already stored for a recruiter', () => {
    const shown = candidateChannels([
      { kind: 'email_corporate', value: 'richa.sharma@himalayas.app', href: 'mailto:richa.sharma@himalayas.app', status: 'hypothesis', sourceUrl: null, observedAt: at },
      { kind: 'linkedin', value: 'richa', href: 'https://www.linkedin.com/in/richa', status: 'published', sourceUrl: null, observedAt: at },
    ]);
    expect(shown.map((channel) => channel.kind)).toEqual(['linkedin']);
  });
});
