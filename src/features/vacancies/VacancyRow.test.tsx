import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { VacancyRow } from './VacancyRow';

function item(overrides: Partial<MatchedVacancyItem['cluster']> = {}): MatchedVacancyItem {
  return {
    cluster: {
      id: 'c-1',
      canonicalTitle: 'Business Information Architect',
      canonicalCompany: 'Genetec',
      canonicalLocation: 'Canada',
      isRemote: true,
      salary: { from: 190000, to: 240000, currency: '$' },
      descriptionSummary: '',
      skills: [],
      primaryUrl: 'https://example.com',
      sources: [],
      firstObservedAt: '2026-09-24T08:00:00.000Z',
      lastSeenAt: '2026-09-24T08:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
      ...overrides,
    },
    explanation: {
      clusterId: 'c-1',
      roleMatch: 'target',
      levelMatch: 'target',
      outsideGeography: false,
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-24T08:00:00.000Z',
    },
  };
}

function render(overrides: Partial<Parameters<typeof VacancyRow>[0]> = {}) {
  return renderToStaticMarkup(
    <VacancyRow
      item={item()}
      now="2026-09-24T09:00:00.000Z"
      isSelected={false}
      onSelect={vi.fn()}
      {...overrides}
    />,
  );
}

describe('VacancyRow (B250)', () => {
  it('shows title, company/location/remote subtitle, compensation and age', () => {
    const html = render();
    expect(html).toContain('Business Information Architect');
    expect(html).toContain('Genetec · Canada · удалённо');
    expect(html).toContain('$');
    expect(html).toContain('190');
  });

  it('renders one fit-dot per role/level/geography and marks misses as no', () => {
    const html = render({
      item: item(),
    });
    // роль и уровень совпадают (target), гео совпадает (outsideGeography=false)
    const yes = html.match(/fit-dot is-yes/g) ?? [];
    expect(yes.length).toBe(3);
  });

  it('marks a missing fit as is-no, not as a silent match', () => {
    const missGeo: MatchedVacancyItem = {
      ...item(),
      explanation: { ...item().explanation, outsideGeography: true },
    };
    const html = render({ item: missGeo });
    expect(html).toContain('fit-dot is-no');
  });

  it('is a real button, not a non-interactive element carrying a role', () => {
    const html = render();
    expect(html).toContain('<button');
    expect(html).not.toContain('role="button"');
  });

  it('marks the selected row so the shell can highlight it', () => {
    const html = render({ isSelected: true });
    expect(html).toContain('is-selected');
    expect(html).toContain('aria-pressed="true"');
  });
});
