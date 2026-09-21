import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminVacancySourcesView } from './AdminVacancySourcesView';
import type { AdminVacancySource } from './adminApi';
import { sourcesFailure, sourcesLoaded, sourcesLoading } from './vacancySourcesState';

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
        state={sourcesLoaded(sampleSources)}
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
        state={sourcesLoaded([
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
        ])}
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

  /**
   * B200 срез 2 — обход ссылок печатается со своим знаменателем и с датой
   * замера, а «не проверяли» называется словами, а не нулём.
   */
  it('печатает обход ссылок объявлений со знаменателем и датой', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView
        state={sourcesLoaded([
          {
            ...sampleSources[0],
            health: {
              liveness: {
                verdict: 'alive',
                reason: 'Свежее 30 дней: 50 из 50',
                lastNonEmptyReadingAt: '2026-09-07T09:00:00.000Z',
                consecutiveEmptyReadings: 0,
                fresherThan30Days: { counted: 50, of: 50 },
                fresherThan90Days: { counted: 50, of: 50 },
                fresherThan180Days: { counted: 50, of: 50 },
                linkCheck: {
                  checkedAt: '2026-09-07T09:00:00.000Z',
                  open: 18,
                  gone: 2,
                  unknown: 0,
                  checked: 20,
                  sampledFrom: 250,
                },
              },
              trust: {
                verdict: 'trusted',
                reasons: [],
                completeness: {
                  withEmployer: { counted: 50, of: 50 },
                  withLink: { counted: 50, of: 50 },
                  withDate: { counted: 50, of: 50 },
                },
                consistency: { successful: { counted: 4, of: 4 } },
                lawfulness: { permitted: true, addressStatus: 'live' },
                authenticity: { measured: false, blockedBy: 'B205' },
              },
            },
          },
        ])}
        onRefresh={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain('Ссылок открылось: 18 из 20');
    expect(html).toContain('выборка из 250');
  });

  it('B200/B205: печатает измеренную подлинность со знаменателем', () => {
    const measuredHealth = {
      liveness: {
        verdict: 'alive' as const,
        reason: 'Свежее 30 дней: 10 из 10',
        lastNonEmptyReadingAt: '2026-09-12T00:00:00.000Z',
        consecutiveEmptyReadings: 0,
        fresherThan30Days: { counted: 10, of: 10 },
        fresherThan90Days: { counted: 10, of: 10 },
        fresherThan180Days: { counted: 10, of: 10 },
      },
      trust: {
        verdict: 'mixed' as const,
        reasons: ['Подлинных объявлений 8 из 10'],
        completeness: {
          withEmployer: { counted: 10, of: 10 },
          withLink: { counted: 10, of: 10 },
          withDate: { counted: 10, of: 10 },
        },
        consistency: { successful: { counted: 4, of: 4 } },
        lawfulness: { permitted: true, addressStatus: 'live' },
        authenticity: {
          measured: true as const,
          originalShare: { counted: 8, of: 10 },
          reprintShare: { counted: 2, of: 10 },
        },
      },
    };

    const html = renderToStaticMarkup(
      <AdminVacancySourcesView
        state={sourcesLoaded([{ ...sampleSources[0], health: measuredHealth }])}
        onRefresh={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain('Подлинных объявлений: 8 из 10');
    expect(html).toContain('Перепечаток: 2 из 10');
    expect(html).not.toContain('ждёт дедупликатора B205');
  });

  it('называет словами, что ссылки объявлений ещё не проверяли', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView
        state={sourcesLoaded([
          {
            ...sampleSources[0],
            health: {
              liveness: {
                verdict: 'alive',
                reason: 'Свежее 30 дней: 50 из 50',
                lastNonEmptyReadingAt: '2026-09-07T09:00:00.000Z',
                consecutiveEmptyReadings: 0,
                fresherThan30Days: { counted: 50, of: 50 },
                fresherThan90Days: { counted: 50, of: 50 },
                fresherThan180Days: { counted: 50, of: 50 },
              },
              trust: {
                verdict: 'trusted',
                reasons: [],
                completeness: {
                  withEmployer: { counted: 50, of: 50 },
                  withLink: { counted: 50, of: 50 },
                  withDate: { counted: 50, of: 50 },
                },
                consistency: { successful: { counted: 4, of: 4 } },
                lawfulness: { permitted: true, addressStatus: 'live' },
                authenticity: { measured: false, blockedBy: 'B205' },
              },
            },
          },
        ])}
        onRefresh={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain('Ссылки объявлений ещё не проверяли');
  });

  it('не выдаёт неопрошенную площадку за живую', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView
        state={sourcesLoaded(sampleSources)}
        onRefresh={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain('Не опрошена');
    // У «доверие неизвестно» приговора нет — причины не повторяют факты.
    expect(html).not.toContain('admin-source-health-reasons');
  });

  it('называет ручной опрос очередью, пока обслуживатель его не выполнил', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView
        state={sourcesLoaded([
          { ...sampleSources[0], manualSync: { status: 'queued' } },
        ])}
        onRefresh={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain('В очереди');
    expect(html).toContain('Обслуживатель заберёт запрос');
    expect(html).toContain('aria-live="polite"');
  });

  /**
   * B207 — отказ загрузки обязан быть назван. Раньше провал маршрута выглядел
   * ровно как честный ответ «источников нет»: пустая сетка и ничего больше.
   */
  it('печатает названный отказ и кнопку повтора вместо пустой сетки', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView
        state={sourcesFailure(new Error('Слишком много запросов. Повторите через 8 минут.'))!}
        onRefresh={vi.fn()}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain('Слишком много запросов. Повторите через 8 минут.');
    expect(html).toContain('Повторить');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('admin-source-card');
  });

  it('пустой список называет себя пустым, а не отказом', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView state={sourcesLoaded([])} onRefresh={vi.fn()} onSync={vi.fn()} />,
    );

    expect(html).toContain('Ни одной площадки не зарегистрировано');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('Повторить');
  });

  it('во время загрузки не выдаёт пустоту за ответ', () => {
    const html = renderToStaticMarkup(
      <AdminVacancySourcesView state={sourcesLoading()} onRefresh={vi.fn()} onSync={vi.fn()} />,
    );

    expect(html).not.toContain('Ни одной площадки не зарегистрировано');
    expect(html).not.toContain('role="alert"');
  });
});
