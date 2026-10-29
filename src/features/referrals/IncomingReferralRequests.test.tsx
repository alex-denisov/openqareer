import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { IncomingReferralRequestsView } from './IncomingReferralRequests';
import type { IncomingReferralRequest } from './referralRequestApi';

const pending: IncomingReferralRequest = {
  id: 'req-1',
  status: 'pending',
  companyName: 'Northwind Labs',
  vacancyTitle: 'CTO',
  createdAt: '2026-10-30T10:00:00.000Z',
  requester: { fullName: 'Boris Seeker', headline: 'Engineering Manager', linkedinUrl: null },
  contacts: [{ fullName: 'Jane Roe', roleTitle: 'CTO' }],
};

describe('IncomingReferralRequestsView (B561 slice 3)', () => {
  it('shows who asks, for which company and the member own contacts there, with both answers', () => {
    const html = renderToStaticMarkup(
      <IncomingReferralRequestsView
        items={[pending]}
        busyId={null}
        error={null}
        onAnswer={vi.fn()}
      />,
    );
    expect(html).toContain('Просят рекомендацию');
    expect(html).toContain('Boris Seeker');
    expect(html).toContain('Engineering Manager');
    expect(html).toContain('Northwind Labs');
    expect(html).toContain('Jane Roe');
    expect(html).toContain('Познакомить');
    expect(html).toContain('Отказаться');
  });

  it('after accepting gives the asker profile and no more buttons', () => {
    const html = renderToStaticMarkup(
      <IncomingReferralRequestsView
        items={[
          {
            ...pending,
            status: 'accepted',
            requester: {
              ...pending.requester,
              linkedinUrl: 'https://www.linkedin.com/in/boris-seeker/',
            },
          },
        ]}
        busyId={null}
        error={null}
        onAnswer={vi.fn()}
      />,
    );
    expect(html).toContain('href="https://www.linkedin.com/in/boris-seeker/"');
    expect(html).not.toContain('Отказаться');
  });

  it('renders nothing without requests', () => {
    expect(
      renderToStaticMarkup(
        <IncomingReferralRequestsView items={[]} busyId={null} error={null} onAnswer={vi.fn()} />,
      ),
    ).toBe('');
  });
});
