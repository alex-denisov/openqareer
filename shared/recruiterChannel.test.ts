import { describe, expect, it } from 'vitest';
import { candidateChannels, letterDeliveryChannel } from './recruiterChannel';

const at = '2026-10-27T00:00:00.000Z';

describe('candidate channels', () => {
  it('drops an email on a job board domain already stored for a recruiter', () => {
    const shown = candidateChannels([
      {
        kind: 'email_corporate',
        value: 'richa.sharma@himalayas.app',
        href: 'mailto:richa.sharma@himalayas.app',
        status: 'hypothesis',
        sourceUrl: null,
        observedAt: at,
      },
      {
        kind: 'linkedin',
        value: 'richa',
        href: 'https://www.linkedin.com/in/richa',
        status: 'published',
        sourceUrl: null,
        observedAt: at,
      },
    ]);
    expect(shown.map((channel) => channel.kind)).toEqual(['linkedin']);
  });
});

describe('letter delivery channel', () => {
  const channel = (
    kind: 'telegram' | 'email_corporate' | 'linkedin' | 'website',
    status: 'verified' | 'published' | 'hypothesis',
    value: string,
  ) => ({
    kind,
    value,
    href: null,
    status,
    sourceUrl: 'https://internal.example',
    observedAt: at,
  });

  it('takes the most valuable confirmed channel without its internal receipt', () => {
    expect(
      letterDeliveryChannel([
        channel('linkedin', 'verified', 'maria'),
        channel('email_corporate', 'published', 'm@acme.com'),
      ]),
    ).toEqual({ kind: 'email_corporate', value: 'm@acme.com' });
  });

  it('never names a guessed address or a channel a letter cannot go to', () => {
    expect(
      letterDeliveryChannel([channel('email_corporate', 'hypothesis', 'm@acme.com')]),
    ).toBeNull();
    expect(letterDeliveryChannel([channel('website', 'verified', 'acme.com')])).toBeNull();
    expect(letterDeliveryChannel([])).toBeNull();
  });

  it('skips an email on a job board domain', () => {
    expect(
      letterDeliveryChannel([channel('email_corporate', 'verified', 'r@himalayas.app')]),
    ).toBeNull();
  });
});
