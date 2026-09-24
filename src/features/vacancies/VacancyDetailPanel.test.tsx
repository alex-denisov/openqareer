import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { VacancyDetailPanel } from './VacancyDetailPanel';

function item(
  overrides: Partial<MatchedVacancyItem['explanation']> = {},
  clusterOverrides: Partial<MatchedVacancyItem['cluster']> = {},
): MatchedVacancyItem {
  return {
    cluster: {
      id: 'c-1',
      canonicalTitle: 'Business Information Architect',
      canonicalCompany: 'Genetec',
      canonicalLocation: 'Canada',
      isRemote: true,
      salary: { from: 190000, to: 240000, currency: 'USD' },
      descriptionSummary: '',
      skills: [],
      primaryUrl: 'https://example.com/vacancy',
      sources: [{ sourceType: 'hh', sourceId: 'c-1', sourceName: 'hh.ru', sourceUrl: '', observedAt: '' }],
      firstObservedAt: '2026-09-21T08:00:00.000Z',
      lastSeenAt: '2026-09-24T08:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
      ...clusterOverrides,
    },
    explanation: {
      clusterId: 'c-1',
      roleMatch: 'target',
      levelMatch: 'target',
      outsideGeography: false,
      matchingPoints: ['Опыт управления P&L'],
      missingPoints: ['Опыт публичной компании'],
      summary: '',
      calculatedAt: '2026-09-24T08:00:00.000Z',
      ...overrides,
    },
  };
}

function render(overrides: Partial<Parameters<typeof VacancyDetailPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <VacancyDetailPanel
      item={item()}
      now="2026-09-24T09:00:00.000Z"
      onBack={vi.fn()}
      {...overrides}
    />,
  );
}

describe('VacancyDetailPanel (B250)', () => {
  it('shows logo, title, company/location/format and the compact salary', () => {
    const html = render();
    expect(html).toContain('Business Information Architect');
    expect(html).toContain('Genetec · Canada · удалённо');
    expect(html).toContain('$190k');
  });

  it('lists matched facts and unconfirmed points from the explanation', () => {
    const html = render();
    expect(html).toContain('Совпадает по фактам профиля');
    expect(html).toContain('Опыт управления P&amp;L');
    expect(html).toContain('Не подтверждено');
    expect(html).toContain('Опыт публичной компании');
  });

  it('hides the matched/unconfirmed blocks when there is nothing to show', () => {
    const html = render({ item: item({ matchingPoints: [], missingPoints: [] }) });
    expect(html).not.toContain('Совпадает по фактам профиля');
    expect(html).not.toContain('Не подтверждено');
  });

  it('hides the company-signal grid entirely — no enrichment field exists yet', () => {
    const html = render();
    expect(html).not.toContain('vacancies-signals');
  });

  it('shows a primary apply button that opens the source and records the click', () => {
    const html = render();
    expect(html).toContain('Откликнуться');
    expect(html).toContain('https://example.com/vacancy');
  });

  it('shows an already-applied state instead of the apply button once confirmed', () => {
    const applications = {
      applications: [],
      byCluster: new Map([
        [
          'c-1',
          {
            clusterId: 'c-1',
            status: 'applied' as const,
            vacancy: {
              title: 'Business Information Architect',
              company: 'Genetec',
              url: 'https://example.com/vacancy',
              source: 'hh',
            },
            openedAt: '2026-09-19T00:00:00.000Z',
            appliedAt: '2026-09-20T00:00:00.000Z',
            confirmedBy: 'candidate' as const,
          },
        ],
      ]),
      unsaved: new Set<string>(),
      record: vi.fn(),
    };
    const html = render({ applications });
    expect(html).toContain('Отклик отмечен');
    expect(html).not.toContain('>Откликнуться<');
  });

  it('renders a «Назад» control for the mobile full-screen panel', () => {
    const html = render();
    expect(html).toContain('Назад');
  });
});
