import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { VacanciesScreen } from './VacanciesScreen';

function matchedItem(
  id: string,
  title: string,
  overrides: Partial<MatchedVacancyItem['explanation']> = {},
): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: title,
      canonicalCompany: 'Genetec',
      canonicalLocation: 'Дубай',
      isRemote: false,
      descriptionSummary: '',
      skills: [],
      primaryUrl: 'https://example.com',
      sources: [],
      firstObservedAt: '2026-09-24T08:00:00.000Z',
      lastSeenAt: '2026-09-24T08:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target',
      levelMatch: 'match',
      outsideGeography: false,
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-24T08:00:00.000Z',
      ...overrides,
    },
  };
}

const campaign: CampaignMetaView = {
  roles: { value: ['VP Technology Ops'], origin: 'profile' },
  regions: { value: ['Дубай', 'Европа'], origin: 'profile' },
  roleHypotheses: [
    { role: 'VP Technology Ops', vacancyCount: 34, isHypothesis: false },
    { role: 'COO', vacancyCount: 6, isHypothesis: true },
  ],
};

function render(overrides: Partial<Parameters<typeof VacanciesScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <VacanciesScreen
      matched={[matchedItem('c-1', 'VP Technology Ops')]}
      total={61}
      campaign={campaign}
      candidateLevel="VP / C-level"
      now="2026-09-24T09:00:00.000Z"
      {...overrides}
    />,
  );
}

describe('VacanciesScreen (B250)', () => {
  it('shows the campaign role in the eyebrow and the total in the list hint', () => {
    const html = render();
    expect(html).toContain('Кампания · VP Technology Ops');
    expect(html).toContain('61 вакансия');
  });

  it('shows every role hypothesis as a chip with its vacancy count, and marks the hypothesis', () => {
    const html = render();
    expect(html).toContain('VP Technology Ops (34)');
    expect(html).toContain('COO (6) — гипотеза');
    expect(html).toContain('vacancies-chip-hypothesis');
  });

  it('shows the derived candidate level', () => {
    expect(render().toString()).toContain('VP / C-level');
  });

  it('lists every matched vacancy as a row', () => {
    const html = render({
      matched: [matchedItem('c-1', 'VP Technology Ops'), matchedItem('c-2', 'COO')],
    });
    expect(html).toContain('VP Technology Ops');
    expect(html).toContain('COO');
  });

  it('does not render without a campaign or a level', () => {
    expect(() => render({ campaign: undefined, candidateLevel: undefined })).not.toThrow();
  });
});
