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
      expect(html).toContain(
        'Требования: <span class="num">1</span> из <span class="num">2</span>',
      );
    });

    it('shows warning when requirements do not match (0 of M)', () => {
      const zeroMatched: MatchedVacancyItem = {
        ...item(),
        explanation: {
          ...item().explanation,
          matchingPoints: [],
          missingPoints: ['Req 1', 'Req 2'],
        },
      };
      const html = render({ item: zeroMatched });
      expect(html).toContain(
        'Требования: не совпали (<span class="num">0</span> из <span class="num">2</span>)',
      );
    });

    it('does not show requirements line when there are no requirements in description', () => {
      const noReqs: MatchedVacancyItem = {
        ...item(),
        explanation: { ...item().explanation, matchingPoints: [], missingPoints: [] },
      };
      const html = render({ item: noReqs });
      expect(html).not.toContain('vac-req');
    });

    it('separates seniority level from skills list and displays human level row (D28)', () => {
      const levelItem: MatchedVacancyItem = {
        ...item(),
        explanation: {
          ...item().explanation,
          matchingPoints: ['System Architecture'],
          missingPoints: ['vp', 'PostgreSQL'],
        },
      };
      const html = render({ item: levelItem, isSelected: true });
      expect(html).toContain(
        'Требования: <span class="num">1</span> из <span class="num">2</span>',
      );
      expect(html).toContain('Уровень вакансии: <strong>VP</strong>');
      expect(html).toContain('PostgreSQL');
      expect(html).not.toMatch(/<li class="req-no">[^<]*<span>vp<\/span>/);
      expect(html).toContain('Требования вакансии: 1 из 2 подтверждены фактами профиля');
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
  it('exposes server-backed save and company want controls with current states', () => {
    const html = render({
      isSaved: true,
      isCompanyWanted: true,
      onToggleSaved: vi.fn(),
      onToggleCompanyWant: vi.fn(),
    } as never);

    expect(html).toContain('Убрать из сохранённых');
    expect(html).toContain('Убрать из «Хочу»');
    expect(html).toContain('aria-pressed="true"');
  });
});

describe('VacancyRow screen detail requirements (B549)', () => {
  it('shows requirement chips from the fit analysis even when a fit view exists', () => {
    const base = item();
    const withFit: MatchedVacancyItem = {
      ...base,
      explanation: {
        ...base.explanation,
        fitView: {
          state: 'ready',
          requirements: [
            {
              id: 'r1',
              text: 'Kafka',
              sourceQuote: 'Kafka',
              origin: 'explicit',
              importance: 'high',
              stopFactor: false,
            },
            {
              id: 'r2',
              text: 'Kubernetes',
              sourceQuote: 'Kubernetes',
              origin: 'explicit',
              importance: 'high',
              stopFactor: false,
            },
          ],
          result: {
            gates: {},
            assessments: [{ requirementId: 'r1', status: 'matched', evidence: [], checked: true }],
          },
        } as unknown as NonNullable<MatchedVacancyItem['explanation']['fitView']>,
      },
    };
    const html = render({ item: withFit, layout: 'screen', isSelected: true });
    expect(html).toContain('Требования к навыкам');
    expect(html).toMatch(/is-confirmed[^]*Kafka/u);
    expect(html).toMatch(/is-missing[^]*Kubernetes/u);
    expect(html).not.toContain('vacancy-fit-table');
    // Owner 29.10: the old «Соответствие» block never shows on «Вакансии».
    expect(html).not.toContain('Соответствие вашему профилю');
  });

  it('lists every counted requirement, unconfirmed first, under the percent block (28.10)', () => {
    const base = item();
    const names = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'B1', 'B2', 'B3'];
    const withFit: MatchedVacancyItem = {
      ...base,
      explanation: {
        ...base.explanation,
        fitView: {
          state: 'ready',
          requirements: names.map((name) => ({
            id: name,
            text: name,
            sourceQuote: name,
            origin: 'explicit',
            importance: 'high',
            stopFactor: false,
          })),
          result: {
            status: 'assessed',
            reason: 'assessed',
            dataState: 'complete',
            coveragePercent: 70,
            coverage: { matched: 7, total: 10 },
            calculatedAt: '2026-10-26T10:00:00.000Z',
            gates: {},
            assessments: names
              .filter((name) => name.startsWith('A'))
              .map((name) => ({
                requirementId: name,
                status: 'matched',
                evidence: [],
                checked: true,
              })),
          },
        } as unknown as NonNullable<MatchedVacancyItem['explanation']['fitView']>,
      },
    };
    const html = render({ item: withFit, layout: 'screen', isSelected: true });
    const chips = html.match(/class="vacancies-screen-skill-chip /gu) ?? [];
    expect(chips).toHaveLength(10);
    expect(html).toMatch(/is-missing[^]*B3[^]*is-confirmed[^]*A1/u);
    expect(html).not.toContain('Ещё ');
    expect(html).toMatch(/Требования к навыкам · <span class="num">10<\/span>/u);
    expect(html).toMatch(/<h3>Совпадение 70(&nbsp;|\u00a0)%<\/h3>/u);
    expect(html).toContain('7 из 10 требований вакансии есть в профиле и подтверждены.');
    expect(html).not.toContain('соответствие 70');
  });

  it('says requirements are not parsed when nothing is known', () => {
    const base = item();
    const empty: MatchedVacancyItem = {
      ...base,
      explanation: { ...base.explanation, matchingPoints: [], missingPoints: [] },
    };
    const html = render({ item: empty, layout: 'screen', isSelected: true });
    expect(html).toContain('Требования ещё не разобраны.');
  });
});
