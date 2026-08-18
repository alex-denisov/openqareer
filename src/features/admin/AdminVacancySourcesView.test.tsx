import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminVacancySourcesView } from './AdminVacancySourcesView';
import type { AdminVacancySource } from './adminApi';

describe('AdminVacancySourcesView', () => {
  const sampleSources: AdminVacancySource[] = [
    {
      id: 'src-hh',
      name: 'hh.ru (Россия & СНГ)',
      type: 'hh',
      enabled: true,
      targetUrl: 'https://api.hh.ru/vacancies',
      refreshIntervalMinutes: 60,
      lastSyncAt: '2026-08-18T00:00:00.000Z',
      lastStatus: 'healthy',
      itemsFoundTotal: 120,
      itemsActiveTotal: 115,
    },
    {
      id: 'src-tg',
      name: 'Telegram @it_jobs',
      type: 'telegram',
      enabled: true,
      targetUrl: 'https://t.me/s/it_jobs',
      refreshIntervalMinutes: 30,
      lastSyncAt: '2026-08-18T01:00:00.000Z',
      lastStatus: 'healthy',
      itemsFoundTotal: 45,
      itemsActiveTotal: 40,
    },
  ];

  it('renders the list of vacancy sources with status and stats', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView
        sources={sampleSources}
        loading={false}
        onRefresh={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain('hh.ru (Россия &amp; СНГ)');
    expect(html).toContain('Telegram @it_jobs');
    expect(html).toContain('115 активных');
    expect(html).toContain('40 активных');
    expect(html).toContain('Синхронизировать');
  });
});
