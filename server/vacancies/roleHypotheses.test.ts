import { describe, expect, it } from 'vitest';
import { buildRoleHypotheses } from './roleHypotheses';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * B180, срез 1б. Расчёт переехал на сервер не ради архитектуры, а потому что в
 * браузере считать было не из чего: `matchedVacancyPage.ts` вырезает `skills`
 * из каждой записи ради байтового бюджета маршрута (INC-029), и на проде из
 * 320 прочитанных вакансий требования были ровно у нуля. Здесь пул полный.
 */
function vacancy(id: string, title: string, skills: string[]): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: title,
      canonicalCompany: 'FinCloud',
      canonicalLocation: 'Москва',
      isRemote: true,
      descriptionSummary: 'не показывается',
      skills,
      primaryUrl: `https://example.com/${id}`,
      sources: [
        {
          sourceType: 'hh',
          sourceId: id,
          sourceUrl: `https://example.com/${id}`,
          observedAt: '2026-08-20T08:00:00.000Z',
        },
      ],
      firstObservedAt: '2026-08-20T08:00:00.000Z',
      lastSeenAt: '2026-09-02T08:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      matchScore: 0,
      fitLevel: 'potential',
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-02T08:00:00.000Z',
    },
  } as unknown as MatchedVacancyItem;
}

describe('buildRoleHypotheses (B180, срез 1б)', () => {
  const matched = Array.from({ length: 9 }, (_, index) =>
    vacancy(`pm-${index}`, index % 3 === 0 ? 'Senior Product Manager' : 'Продакт-менеджер', [
      'product discovery',
      'SQL',
    ]),
  );

  it('строит гипотезу на требованиях полного пула — того, чего у браузера нет', () => {
    const [top] = buildRoleHypotheses({
      matched,
      candidateRole: 'VP of Technology, CTO or COO roles in SaaS and FinTech.',
      candidateSkills: ['SQL'],
    });

    expect(top.title).toBe('Продакт-менеджер');
    expect(top.sampleSize).toBe(9);
    expect(top.repeatedRequirements).toContain('SQL');
    expect(top.sources).toEqual([{ source: 'hh', count: 9 }]);
  });

  it('пустой пул не даёт ни одной роли: рынок её ещё не назвал', () => {
    expect(
      buildRoleHypotheses({ matched: [], candidateRole: 'кто угодно', candidateSkills: [] }),
    ).toEqual([]);
  });

  it('ответ остаётся в несколько сотен байт, а не в мегабайт пула', () => {
    const size = Buffer.byteLength(
      JSON.stringify(
        buildRoleHypotheses({ matched, candidateRole: 'продакт', candidateSkills: ['SQL'] }),
      ),
      'utf8',
    );
    expect(size).toBeLessThan(2_048);
  });
});
