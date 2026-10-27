import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CandidateRecruiterChannel } from '../../../shared/recruiterChannel';
import { RecruiterChannelList } from './RecruiterChannelList';

const at = '2026-10-27T00:00:00.000Z';
const channels: CandidateRecruiterChannel[] = [
  { kind: 'telegram', value: '@anna_hr', href: 'https://t.me/anna_hr', status: 'published', observedAt: at },
  { kind: 'viber', value: '+447700900124', href: 'viber://chat?number=%2B447700900124', status: 'published', observedAt: at },
  { kind: 'email_corporate', value: 'anna@acme.com', href: 'mailto:anna@acme.com', status: 'hypothesis', observedAt: at },
];

describe('RecruiterChannelList', () => {
  it('shows each channel with its name, value and link in the given order', () => {
    const html = renderToStaticMarkup(<RecruiterChannelList channels={channels} />);
    expect(html).toContain('href="https://t.me/anna_hr"');
    expect(html.indexOf('Telegram')).toBeLessThan(html.indexOf('Viber'));
    expect(html).toContain('Рабочая почта');
    expect(html).toContain('anna@acme.com');
  });

  it('marks a guessed channel so the candidate knows it may not work', () => {
    const html = renderToStaticMarkup(<RecruiterChannelList channels={channels} />);
    expect(html).toMatch(/data-status="hypothesis"[^>]*>[^]*Предположение/u);
  });

  it('renders nothing without channels', () => {
    expect(renderToStaticMarkup(<RecruiterChannelList channels={[]} />)).toBe('');
  });
});
