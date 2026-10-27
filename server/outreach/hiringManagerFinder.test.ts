import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { FootprintRequestGate } from '../osint/adapters/requestScheduler';
import { findHiringManager, pickHiringManager, vacancyFunction } from './hiringManagerFinder';

const hit = (name: string, headline: string, slug: string) => ({
  url: `https://www.linkedin.com/in/${slug}`,
  title: `${name} - ${headline}`,
  text: `# ${name}\n${headline}\nLondon`,
});

describe('hiring manager', () => {
  it('keeps the direction of the vacancy without the level', () => {
    expect(vacancyFunction('Senior Data Engineer (Payments)')).toBe('Data');
    expect(vacancyFunction('Ведущий аналитик данных')).toBe('данных');
  });

  it('picks a manager of the same company closest to the vacancy, never a recruiter', () => {
    const manager = pickHiringManager(
      [
        hit('Rita Hall', 'Talent Acquisition Lead at Acme', 'rita'),
        hit('Tom Reed', 'Head of Marketing at Acme', 'tom'),
        hit('Nina Cole', 'Head of Data Platform at Acme', 'nina'),
        hit('Sam Fox', 'Head of Data at Globex', 'sam'),
      ],
      'Acme',
      'Senior Data Platform Engineer',
    );
    expect(manager).toEqual({ fullName: 'Nina Cole', roleTitle: 'Head of Data Platform at Acme', linkedinUrl: 'https://www.linkedin.com/in/nina' });
  });

  it('searches once per company and direction', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [hit('Nina Cole', 'Head of Data at Acme', 'nina')] }), { status: 200 }));
    const options = { database: new DatabaseSync(':memory:'), apiKey: 'k', fetch, requestGate: new FootprintRequestGate({ intervalMs: 0 }) };
    const vacancy = { id: 'v', company: 'Acme', title: 'Data Engineer' };
    expect((await findHiringManager(vacancy, options))?.fullName).toBe('Nina Cole');
    expect((await findHiringManager({ ...vacancy, id: 'v2' }, options))?.fullName).toBe('Nina Cole');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
