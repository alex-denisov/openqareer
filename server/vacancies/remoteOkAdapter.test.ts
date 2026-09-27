import { describe, expect, it } from 'vitest';
import { normalizeJsonSource } from './jsonSourceAdapters';

const OBSERVED_AT = '2026-08-30T12:00:00.000Z';

describe('RemoteOK adapter (C62)', () => {
  it('парсит зарплату salary_min и salary_max в USD из записи RemoteOK', () => {
    const [vacancy] = normalizeJsonSource(
      'src-remoteok',
      [
        {
          id: '1091235',
          position: 'Senior Go Developer',
          company: 'Cloud Corp',
          location: 'Worldwide',
          url: 'https://remoteok.com/remote-jobs/1091235',
          salary_min: 120000,
          salary_max: 160000,
          tags: ['golang'],
          date: '2026-08-28T10:00:00+00:00',
        },
      ],
      { observedAt: OBSERVED_AT },
    );

    expect(vacancy).toMatchObject({
      title: 'Senior Go Developer',
      company: 'Cloud Corp',
      salary: {
        from: 120000,
        to: 160000,
        currency: 'USD',
      },
    });
  });

  it('сохраняет одностороннюю вилку salary_min без salary_max', () => {
    const [vacancy] = normalizeJsonSource(
      'src-remoteok',
      [
        {
          id: '1091236',
          position: 'Tech Lead',
          company: 'Startup Inc',
          url: 'https://remoteok.com/remote-jobs/1091236',
          salary_min: 150000,
          date: '2026-08-28T10:00:00+00:00',
        },
      ],
      { observedAt: OBSERVED_AT },
    );

    expect(vacancy?.salary).toEqual({
      from: 150000,
      currency: 'USD',
    });
  });
});
