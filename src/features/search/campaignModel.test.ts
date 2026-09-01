import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { buildSearchCampaign } from './campaignModel';

/**
 * «Поиск» из макета «Пульт» — это кампания: плитки, воронка и очередь на
 * сегодня. Продукт не считает просмотры, ответы и интервью, поэтому в тех же
 * местах стоит честное «не отслеживается», а не ноль (B179). Ноль сказал бы,
 * что мы посмотрели и не нашли.
 */
const NOW = '2026-09-02T10:00:00.000Z';

function item(id: string, firstObservedAt: string, score = 70): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: `Вакансия ${id}`,
      canonicalCompany: 'FinCloud',
      canonicalLocation: 'Москва',
      isRemote: true,
      descriptionSummary: '',
      skills: [],
      primaryUrl: `https://example.test/${id}`,
      sources: [
        {
          sourceType: 'remotive',
          sourceId: 'remotive',
          sourceUrl: 'https://example.test',
          observedAt: firstObservedAt,
        },
      ],
      firstObservedAt,
      lastSeenAt: firstObservedAt,
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      matchScore: score,
      fitLevel: 'good',
      matchingPoints: ['Целевая роль'],
      missingPoints: [],
      summary: '',
      calculatedAt: firstObservedAt,
    },
  } as unknown as MatchedVacancyItem;
}

describe('buildSearchCampaign', () => {
  const pool = [
    item('a', '2026-09-02T06:00:00.000Z', 90),
    item('b', '2026-09-02T07:00:00.000Z', 80),
    item('c', '2026-08-28T07:00:00.000Z', 60),
  ];

  it('считает новых сегодня по дате первого сбора', () => {
    const campaign = buildSearchCampaign({ pool, commands: [], now: NOW });

    expect(campaign.freshToday).toBe(2);
    expect(campaign.poolTotal).toBe(3);
  });

  it('не выдаёт неизмеряемое за ноль', () => {
    const campaign = buildSearchCampaign({ pool, commands: [], now: NOW });
    const answers = campaign.tiles.find((tile) => tile.id === 'answers');

    expect(answers?.value).toBeUndefined();
    expect(answers?.note).toBe('не отслеживается');
  });

  it('отклики берёт из подтверждённых команд, а не из воздуха', () => {
    const campaign = buildSearchCampaign({
      pool,
      commands: [{ status: 'queued' }, { status: 'draft' }, { status: 'sent' }],
      now: NOW,
    });

    expect(campaign.tiles.find((tile) => tile.id === 'applications')?.value).toBe(2);
  });

  it('воронка называет только измеренные ступени', () => {
    const campaign = buildSearchCampaign({ pool, commands: [{ status: 'sent' }], now: NOW });

    expect(campaign.funnel.map((step) => [step.label, step.value])).toEqual([
      ['подобрано', 3],
      ['отклик', 1],
      ['просмотр', undefined],
      ['ответ', undefined],
      ['интервью', undefined],
    ]);
  });

  it('очередь на сегодня — самые подходящие записи пула', () => {
    const campaign = buildSearchCampaign({ pool, commands: [], now: NOW });

    expect(campaign.queue.map((entry) => entry.cluster.id)).toEqual(['a', 'b', 'c']);
  });

  it('активность за 14 дней — счёт по дням, а не сглаженная кривая', () => {
    const campaign = buildSearchCampaign({ pool, commands: [], now: NOW });

    expect(campaign.activity).toHaveLength(14);
    expect(campaign.activity.at(-1)).toBe(2);
    expect(campaign.activity.reduce((sum, day) => sum + day, 0)).toBe(3);
  });
});
