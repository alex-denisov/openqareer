import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import type { VacancyApplications } from './useVacancyApplications';
import { VacanciesScreen, filterByScreenState } from './VacanciesScreen';

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
  remoteOnly: false,
  autoRoles: [
    {
      id: 'primary',
      title: 'VP Technology Ops',
      titleRu: 'Вице-президент по технологиям',
      level: 'vp',
      kind: 'primary',
      reason: 'Управлял технологическими операциями.',
      evidenceRefs: ['memory:1'],
      evidence: ['Управлял технологическими операциями.'],
    },
    {
      id: 'adjacent',
      title: 'COO',
      titleRu: 'Операционный директор',
      level: 'c-level',
      kind: 'adjacent',
      reason: 'Руководил операциями.',
      evidenceRefs: ['memory:2'],
      evidence: ['Руководил операциями.'],
    },
  ],
  roleHypotheses: [
    { role: 'VP Technology Ops', vacancyCount: 34, isHypothesis: false },
    { role: 'COO', vacancyCount: 6, isHypothesis: true },
  ],
};

function campaignWithCount(vacancyCount: number): CampaignMetaView {
  return {
    ...campaign,
    roleHypotheses: [{ role: 'VP Technology Ops', vacancyCount, isHypothesis: vacancyCount < 8 }],
  };
}

function render(overrides: Partial<Parameters<typeof VacanciesScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <VacanciesScreen
      matched={[matchedItem('c-1', 'VP Technology Ops')]}
      total={61}
      facets={{
        total: 61,
        regions: [{ id: 'mena', count: 61 }],
        remote: 0,
        levels: [{ level: 'vp', count: 61 }],
        roles: [
          { role: 'VP Technology Ops', count: 34 },
          { role: 'COO', count: 6 },
        ],
        sources: [],
      }}
      campaign={campaign}
      candidateLevel="VP / C-level"
      now="2026-09-24T09:00:00.000Z"
      {...overrides}
    />,
  );
}

describe('VacanciesScreen (B250)', () => {
  it('renders the mockup summary above filters from the server pool and current results', () => {
    const html = render({
      matched: [
        matchedItem('c-1', 'VP Technology Ops'),
        matchedItem('c-2', 'COO'),
        matchedItem('c-3', 'Head of Engineering'),
      ],
      total: 61,
      poolComplete: true,
      facets: {
        total: 61,
        regions: [],
        remote: 0,
        levels: [],
        roles: [],
        sources: [],
        catalogSummary: {
          roleLevelMatches: 214,
          catalogTotal: 1_620,
          observedAt: '2026-10-07T06:12:00.000Z',
        },
      },
    });

    expect(html).toContain('vacancies-search-summary');
    expect(html).toContain('vacancies-summary-count');
    expect(html).toContain('214');
    expect(html).toMatch(/1\s?620/u);
    expect(html).toContain('Показано');
    expect(html).toContain('vacancies-summary-reset');
    expect(html.indexOf('vacancies-search-summary')).toBeLessThan(
      html.indexOf('vacancies-filter-toolbar'),
    );
  });

  it('renders the approved desktop column header and corresponding row fields', () => {
    const html = render({
      matched: [matchedItem('c-1', 'Head of Product, Merchant Onboarding')],
      total: 1,
      poolComplete: true,
    });

    expect(html).toContain('vacancies-table-header');
    for (const label of ['Роль', 'Уровень', 'Гео', 'Деньги']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('vacancies-screen-cell--level');
    expect(html).toContain('vacancies-screen-cell--geo');
    expect(html).toContain('vacancies-screen-cell--salary');
  });

  it('keeps saved vacancies as the collection entry point without the legacy saved-search CTA', () => {
    const html = render();

    expect(html).toContain('Сохранённые');
    expect(html).not.toContain('Сохранённые поиски');
  });

  it('shows an archived response instead of an active application mark', () => {
    const applications: VacancyApplications = {
      applications: [],
      byCluster: new Map(),
      unsaved: new Set(),
      record: vi.fn(),
      recordConfirmed: vi.fn(),
    };
    const html = render({
      matched: [matchedItem('c-1', 'VP Technology Ops')],
      applications,
      archivedApplicationClusterIds: new Set(['c-1']),
    });

    expect(html).toContain('Отклик в архиве');
    expect(html).not.toContain('Отклик отмечен');
  });

  it('says «Загружено N из M» while the pool is still incomplete (B338)', () => {
    const html = render({ total: 1, poolComplete: false });
    expect(html).toContain('Загружено');
    expect(html).not.toContain('Показано');
  });

  it('uses the vacancies title without the campaign eyebrow and keeps the total hint', () => {
    const html = render();
    expect(html).toContain('>Вакансии</h1>');
    expect(html).not.toContain('Кампания · VP Technology Ops');
    expect(html).not.toContain('path-strip');
    // B338-2: число стоит одной строкой «Показано N из M» над списком.
    expect(html).toContain('Показано');
    expect(html).not.toContain('показаны совпадающие по роли и уровню');
  });

  it('shows every role hypothesis as a chip with its vacancy count, and marks the hypothesis', () => {
    const html = render();
    expect(html).toContain('VP Technology Ops ·');
    expect(html).toContain('COO ·');
    expect(html).toContain('vacancy-facet-count');
  });

  it('shows that level is derived from profile experience without an edit link (D28)', () => {
    expect(render().toString()).toContain('Уровень берётся из опыта в профиле');
    expect(render().toString()).not.toContain('изменить в профиле');
  });

  it('lists every matched vacancy as a row', () => {
    const html = render({
      matched: [matchedItem('c-1', 'VP Technology Ops'), matchedItem('c-2', 'COO')],
    });
    expect(html).toContain('VP Technology Ops');
    expect(html).toContain('COO');
  });

  it('preserves the matched order supplied by the server', () => {
    const html = render({
      matched: [
        matchedItem('server-first', 'Server first partial', { roleMatch: 'partial' }),
        matchedItem('server-second', 'Server second target', { roleMatch: 'target' }),
      ],
    });

    expect(html.indexOf('Server first partial')).toBeLessThan(html.indexOf('Server second target'));
  });

  it('defaults to «Все роли кампании» and lists vacancies for every role', () => {
    const html = render({
      matched: [matchedItem('c-1', 'VP Technology Ops'), matchedItem('c-2', 'COO')],
    });
    expect(html).not.toContain('Все роли кампании');
    expect(html).toContain('Фильтры 0');
  });

  it('does not render without a campaign or a level', () => {
    expect(() => render({ campaign: undefined, candidateLevel: undefined })).not.toThrow();
  });

  it('marks counts of zero and five as a hypothesis, but not eight', () => {
    const empty = render({
      campaign: campaignWithCount(0),
      matched: [],
      total: 0,
      facets: undefined,
    });
    expect(empty).toContain('По роли VP Technology Ops найдено 0 вакансий');
    expect(empty).toContain('По роли VP Technology Ops пока нет вакансий');

    const five = render({ campaign: campaignWithCount(5), total: 5 });
    expect(five).toContain('По роли VP Technology Ops найдено 5 вакансий');

    const eight = render({ campaign: campaignWithCount(8), total: 8 });
    expect(eight).not.toContain('vacancy-hypothesis-banner');
  });

  it('не показывает блок «Сохранённые запросы» на экране «Вакансии»', () => {
    const html = render({ matched: [], total: 0, facets: undefined });

    expect(html).not.toContain('career-vacancy-saved');
    expect(html).not.toContain('Новый запрос к площадке');
    expect(html).toContain('По роли VP Technology Ops пока нет вакансий');
  });

  it('баннер не предлагает «Расширить географию», когда кандидат сам не выбирал регион', () => {
    const html = render({
      campaign: { ...campaignWithCount(5), regions: { value: ['Дубай'], origin: 'profile' } },
    });
    expect(html).not.toContain('Расширить географию');
  });

  it('баннер предлагает «Расширить географию», когда кандидат сам выбрал регион', () => {
    const html = render({
      campaign: { ...campaignWithCount(5), regions: { value: ['Дубай'], origin: 'explicit' } },
    });
    expect(html).toContain('Расширить географию');
  });

  it('names the available source and offers a retry when loading fails', () => {
    const html = render({ failed: true, failureSourceLabel: 'Remotive', onRetry: () => {} });

    expect(html).toContain('Не удалось загрузить подборку');
    expect(html).toContain('Remotive');
    expect(html).toContain('Повторить');
  });

  it('показывает кнопку «Добавить: <регион>» в фильтре «География» из suggestedRegions, сам не применяя (C63)', () => {
    const html = render({
      campaign: {
        ...campaignWithCount(10),
        regions: { value: [], origin: 'default' },
        suggestedRegions: ['mena'],
      },
    });
    expect(html).not.toContain('Добавить: MENA');
  });

  it('кампания с origin: profile читается как без ограничения (regions=[]) и предлагает подсказку (C63)', () => {
    const html = render({
      campaign: {
        ...campaignWithCount(5),
        regions: { value: ['mena'], origin: 'profile' },
      },
    });
    expect(html).not.toContain('Расширить географию');
    expect(html).not.toContain('Добавить: MENA');
  });

  it('кампания с явным пустым выбором (без ограничения) не предлагает «Расширить географию» (C63)', () => {
    const html = render({
      campaign: {
        ...campaignWithCount(5),
        regions: { value: [], origin: 'explicit' },
      },
    });
    expect(html).not.toContain('Расширить географию');
  });

  it('uses server counts for the saved vacancies and companies tabs', () => {
    const html = render({
      savedVacancies: [
        {
          id: 'saved-1',
          clusterId: 'c-1',
          stage: 'saved',
          vacancy: { title: 'VP Technology Ops' },
        },
      ],
      companiesCount: 61,
    } as never);

    expect(html).toContain('Сохранённые 1');
    expect(html).toContain('Компании и люди 61');
  });


  it('keeps the mobile map control available without optional facet metadata', () => {
    const html = render({ facets: undefined });
    expect(html).toContain('vacancies-mobile-map-action');
    expect(html).toContain('Карта');
  });
  it('filters by salary, explicit location text, and known work format without guessing missing salary', () => {
    const eligible = {
      ...matchedItem('eligible', 'VP Engineering'),
      cluster: {
        ...matchedItem('eligible', 'VP Engineering').cluster,
        canonicalLocation: 'Berlin · hybrid',
        isRemote: false,
        salary: { from: 140_000, to: 180_000, currency: 'EUR' },
      },
    };
    const missingSalary = matchedItem('missing-salary', 'VP Engineering');
    const differentLocation = {
      ...matchedItem('different-location', 'VP Engineering'),
      cluster: {
        ...matchedItem('different-location', 'VP Engineering').cluster,
        canonicalLocation: 'Paris',
      },
    };
    const criteria = {
      roles: [],
      regions: [],
      levels: [],
      sources: [],
      remoteOnly: false,
      salaryMinimum: 130_000,
      salaryCurrency: 'EUR',
      includeMissingSalary: false,
      formats: ['hybrid'],
      locationSearch: 'Berlin',
    } as never;

    const filtered = filterByScreenState(
      [eligible, missingSalary, differentLocation],
      criteria,
      '2026-10-10T00:00:00.000Z',
    );

    expect(filtered.map((item) => item.cluster.id)).toEqual(['eligible']);
  });
});
