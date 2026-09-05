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

  /**
   * B200 — живость и доверие показываются раздельно, и каждое число называет
   * свой знаменатель. Иначе «площадка отвечает» и «площадка жива» выглядели на
   * экране одинаково, а «10 %» скрывало размер выборки.
   */
  it('печатает живость и доверие раздельно, со знаменателями', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView
        sources={[
          {
            ...sampleSources[0],
            health: {
              liveness: {
                verdict: 'dead',
                reason: 'Ни одной вакансии свежее 180 дней: 0 из 96',
                lastNonEmptyReadingAt: '2026-02-01T00:00:00.000Z',
                consecutiveEmptyReadings: 0,
                fresherThan30Days: { counted: 0, of: 96 },
                fresherThan90Days: { counted: 0, of: 96 },
                fresherThan180Days: { counted: 0, of: 96 },
              },
              trust: {
                verdict: 'low',
                reasons: ['Работодатель назван у 10 из 96 карточек'],
                completeness: {
                  withEmployer: { counted: 10, of: 96 },
                  withLink: { counted: 96, of: 96 },
                  withDate: { counted: 96, of: 96 },
                },
                consistency: { successful: { counted: 3, of: 4 } },
                lawfulness: { permitted: false, addressStatus: 'robots_forbidden' },
                authenticity: { measured: false, blockedBy: 'B205' },
              },
            },
          },
        ]}
        loading={false}
        onRefresh={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain('Мертва');
    expect(html).toContain('Не доверять');
    expect(html).toContain('Ни одной вакансии свежее 180 дней: 0 из 96');
    expect(html).toContain('Работодатель назван у 10 из 96 карточек');
    expect(html).toContain('свежее 30 дней: 0 из 96');
    expect(html).toContain('успешных опросов: 3 из 4');
    // Подлинность не измерена и не притворяется числом.
    expect(html).toContain('Подлинность не измерена');
  });

  it('не выдаёт неопрошенную площадку за живую', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView
        sources={sampleSources}
        loading={false}
        onRefresh={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain('Не опрошена');
    // У «доверие неизвестно» приговора нет — причины не повторяют факты.
    expect(html).not.toContain('admin-source-health-reasons');
  });
});
