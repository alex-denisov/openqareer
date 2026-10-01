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
      levelMatch: 'match',
      outsideGeography: false,
      matchingPoints: ['System Architecture'],
      missingPoints: ['10 years team lead'],
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
      onOpenNetworking={vi.fn()}
      onMarkAlreadyApplied={vi.fn()}
      {...overrides}
    />,
  );
}

describe('VacancyRow (B266/B324)', () => {
  it('shows title, company/location/remote subtitle, compensation and age', () => {
    const html = render();
    expect(html).toContain('Business Information Architect');
    expect(html).toContain('Genetec · Canada · удалённо');
    expect(html).toContain('$');
    expect(html).toContain('190');
    expect(html).toContain('в базе');
  });

  it('renders one fit-dot per role/level/geography and marks matches as is-yes', () => {
    const html = render({
      item: item(),
    });
    // роль и уровень совпадают (target/match), гео совпадает (outsideGeography=false)
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
    expect(html).toContain('География: не совпадает');
  });

  it('keeps an unknown level neutral and names the missing signal', () => {
    const unknown: MatchedVacancyItem = {
      ...item(),
      explanation: { ...item().explanation, levelMatch: 'unknown' },
    };
    const html = render({ item: unknown });

    expect(html).toContain('fit-dot is-unknown');
    expect(html).toContain('Уровень не распознан');
    expect(html).toContain('aria-label="Уровень не распознан"');
  });

  it('renders status nearby (is-nearby) when level is partially matching', () => {
    const nearby: MatchedVacancyItem = {
      ...item(),
      explanation: { ...item().explanation, levelMatch: 'below' },
    };
    const html = render({ item: nearby });
    expect(html).toContain('fit-dot is-nearby');
    expect(html).toContain('Уровень: рядом');
  });

  it('labels adjacent roles separately from target-function matches', () => {
    const adjacent: MatchedVacancyItem = {
      ...item(),
      explanation: { ...item().explanation, roleMatch: 'partial', adjacentRole: true },
    };
    const html = render({ item: adjacent });
    expect(html).toContain('fit-dot is-nearby');
    expect(html).toContain('Роль: смежная (рядом)');
  });

  it('is a real button, not a non-interactive element carrying a role', () => {
    const html = render();
    expect(html).toContain('<button');
    expect(html).not.toContain('role="button"');
  });

  it('marks the selected row with is-selected, aria-expanded and renders vac-detail with 5 action buttons', () => {
    const html = render({ isSelected: true });
    expect(html).toContain('is-selected');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('vac-detail');
    expect(html).toContain('Откликнуться');
    expect(html).toContain('Я уже откликнулся');
    expect(html).toContain('Нетворкинг');
    expect(html).toContain('Подробнее');
    expect(html).toContain('Сопроводительное письмо');
    expect(html).toContain('Кто нанимает');
  });

  describe('requirements summary in vacancy row', () => {
    it('shows requirements count when requirements exist', () => {
      const html = render();
      expect(html).toContain('Требования: <span class="num">1 из 2</span>');
    });

    it('shows warning when requirements do not match (0 of M)', () => {
      const zeroMatched: MatchedVacancyItem = {
        ...item(),
        explanation: { ...item().explanation, matchingPoints: [], missingPoints: ['Req 1', 'Req 2'] },
      };
      const html = render({ item: zeroMatched });
      expect(html).toContain('Требования: не совпали (<span class="num">0 из 2</span>)');
    });

    it('does not show requirements line when there are no requirements in description', () => {
      const noReqs: MatchedVacancyItem = {
        ...item(),
        explanation: { ...item().explanation, matchingPoints: [], missingPoints: [] },
      };
      const html = render({ item: noReqs });
      expect(html).not.toContain('vac-req');
    });
  });

  describe('B262 · trust signals in vacancy row', () => {
    it('does not render trust line for clean/ok vacancies', () => {
      const html = render();
      expect(html).not.toContain('vac-trust-line');
    });

    it('renders single-line stale reason for vacancies open >= 60 days', () => {
      const staleItem = item({
        firstObservedAt: '2026-07-01T08:00:00.000Z', // > 60 days before 2026-09-24
      });
      const html = render({ item: staleItem });
      expect(html).toContain('vac-trust-line');
      expect(html).toContain('is-stale');
      expect(html).toContain('Вакансия открыта более 60 дней');
    });

    it('renders single-line suspicious reason for dead links', () => {
      const deadItem = item({
        deadLink: true,
      });
      const html = render({ item: deadItem });
      expect(html).toContain('vac-trust-line');
      expect(html).toContain('is-suspicious');
      expect(html).toContain('Ссылка на вакансию недоступна');
    });
  });
});
