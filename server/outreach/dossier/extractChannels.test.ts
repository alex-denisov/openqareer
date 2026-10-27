import { describe, expect, it } from 'vitest';
import { candidateChannels } from '../../../shared/recruiterChannel';
import { extractChannels } from './extractChannels';

const at = '2026-10-27T00:00:00.000Z';

describe('channel extraction from an open page', () => {
  it('finds messengers, social profiles, phones and both kinds of email', () => {
    const text = `Anna Smith, Talent Partner at Acme.
      Write me: t.me/anna_hr or https://wa.me/447700900123, viber://chat?number=%2B447700900124
      https://www.facebook.com/anna.smith.hr https://instagram.com/anna.hires/
      anna.smith@acme.com, anna.private@gmail.com, +44 7700 900125
      https://vk.com/annasmith https://x.com/annahires`;

    const kinds = extractChannels(text, { companyDomain: 'acme.com', sourceUrl: 'https://anna.example/about', observedAt: at })
      .map((c) => `${c.kind}=${c.value}`);

    expect(kinds).toEqual(expect.arrayContaining([
      'telegram=@anna_hr',
      'whatsapp=+447700900123',
      'viber=+447700900124',
      'facebook=anna.smith.hr',
      'instagram=anna.hires',
      'email_corporate=anna.smith@acme.com',
      'email_personal=anna.private@gmail.com',
      'phone=+44 7700 900125',
      'vk=annasmith',
      'x=annahires',
    ]));
  });

  it('marks every channel as published with an internal source', () => {
    const [channel] = extractChannels('t.me/anna_hr', { sourceUrl: 'https://p.example', observedAt: at });
    expect(channel).toMatchObject({ status: 'published', sourceUrl: 'https://p.example', href: 'https://t.me/anna_hr' });
  });

  it('ignores share buttons and generic company mailboxes', () => {
    const text = 'https://www.facebook.com/sharer/sharer.php?u=x https://instagram.com/p/abc noreply@acme.com';
    expect(extractChannels(text, { companyDomain: 'acme.com', sourceUrl: null, observedAt: at })).toEqual([]);
  });
});

describe('what the candidate sees', () => {
  const channel = (kind: string, value: string) => ({
    kind, value, href: null, status: 'published', sourceUrl: 'https://s', observedAt: at,
  }) as never;

  it('orders by value to the candidate and hides the source', () => {
    const shown = candidateChannels([channel('email_corporate', 'a@acme.com'), channel('telegram', '@a'), channel('linkedin', 'a')]);
    expect(shown.map((c) => c.kind)).toEqual(['telegram', 'email_corporate']);
    expect(shown[0]).not.toHaveProperty('sourceUrl');
  });

  it('falls back to other networks only when no primary channel exists', () => {
    expect(candidateChannels([channel('linkedin', 'a'), channel('github', 'a')]).map((c) => c.kind)).toEqual(['linkedin', 'github']);
  });
});
