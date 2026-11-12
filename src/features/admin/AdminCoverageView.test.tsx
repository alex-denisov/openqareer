import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminCoverageView, type CoverageListState, type CoverageTotalsState } from './AdminCoverageView';
import type { CoverageCompany, CoverageTotals } from './coverageApi';

const NOW = Date.UTC(2026, 10, 12, 11, 10);

const TOTALS: CoverageTotals = {
  totalCompanies: 261_964,
  computedAt: NOW - 7 * 60_000,
  classes: {
    ats: { companies: 134_127, vacancies: 384_143 },
    site: { companies: 20_918, vacancies: 343_073 },
    aggregator_only: { companies: 7_490, vacancies: 71_524 },
    linkedin_only: { companies: 41, vacancies: 1_142 },
    none: { companies: 99_388, vacancies: 0 },
  },
};

const MTS: CoverageCompany = {
  companyKey: 'mts',
  name: 'МТС',
  class: 'site',
  vacancies: 3_789,
  placements: [
    { type: 'employer_site', id: 'site:src-company-site-mts', health: 'healthy', lastCheckedAt: NOW - 3 * 3_600_000, domain: 'mts.ru' },
    { type: 'ats', id: 'ats:greenhouse:mts', health: 'degraded', lastCheckedAt: NOW - 5 * 60_000 },
    { type: 'employer_site', id: 'site:job.mts.ru', health: null, lastCheckedAt: null, domain: 'mts.ru' },
  ],
};

const RZD: CoverageCompany = {
  companyKey: 'rzd',
  name: 'Российские железные дороги',
  class: 'aggregator_only',
  vacancies: 3_951,
  placements: [],
};

const ready: CoverageTotalsState = { status: 'ready', totals: TOTALS };
const list = (patch: Partial<CoverageListState> = {}): CoverageListState => ({
  filter: 'all',
  items: [MTS, RZD],
  nextCursor: 'c1',
  status: 'ready',
  ...patch,
});

function render(totals: CoverageTotalsState, companies: CoverageListState): string {
  return renderToStaticMarkup(
    <AdminCoverageView
      totals={totals}
      list={companies}
      now={NOW}
      onRefresh={vi.fn()}
      onFilter={vi.fn()}
      onMore={vi.fn()}
      onRetryList={vi.fn()}
    />,
  );
}

describe('AdminCoverageView', () => {
  it('shows the direct share and counts pool rows as объявления, not вакансии', () => {
    const html = render(ready, list());
    expect(html).toContain('Покрытие компаний');
    expect(html).toContain('59,2 %');
    expect(html).toContain('объявлений в пуле');
    expect(html).not.toMatch(/вакансий в пуле/);
    expect(html).toContain('Обновлено 7 мин назад');
    expect(html).toContain('Показано 2 из 261');
    expect(html).toContain('Показать ещё 50');
  });

  it('names site placements by domain and words health; never checked has no time', () => {
    const html = render(ready, list());
    expect(html).toContain('mts.ru');
    expect(html).not.toContain('>Сайт</b>');
    expect(html).toContain('работает · 3 ч назад');
    expect(html).toContain('замедлен · 5 мин назад');
    expect(html).toMatch(/ещё не проверялось<\/span>/);
    expect(html).toContain('Своих размещений нет');
  });

  it('marks the selected class in both the table and the chips', () => {
    const html = render(ready, list({ filter: 'ats', items: [] , nextCursor: null }));
    expect(html).toMatch(/class="admin-coverage-class is-selected" aria-pressed="true"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*ATS<\/button>/);
  });

  it('loading: skeleton and disabled refresh', () => {
    const html = render({ status: 'loading' }, list({ items: [], status: 'loading', nextCursor: null }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Обновить/);
  });

  it('error: totals failed, offers retry', () => {
    const html = render({ status: 'error', message: 'x' }, list({ items: [], status: 'error', nextCursor: null }));
    expect(html).toContain('Не удалось получить итоги покрытия');
    expect(html).toContain('Повторить');
  });

  it('partial: list failed, rows that came stay', () => {
    const html = render(ready, list({ status: 'error' }));
    expect(html).toContain('страница компаний не пришла');
    expect(html).toContain('Загрузить список');
    expect(html).toContain('МТС');
  });

  it('empty class offers to show all', () => {
    const html = render(ready, list({ filter: 'linkedin_only', items: [], nextCursor: null }));
    expect(html).toContain('Ни одна компания пока не попала в «Только LinkedIn»');
    expect(html).toContain('Показать все');
  });

  it('end of list: no more button, all shown', () => {
    const html = render(ready, list({ filter: 'linkedin_only', items: [MTS], nextCursor: null }));
    expect(html).toContain('Показаны все 1 компания');
    expect(html).not.toContain('Показать ещё');
  });

  it('stale totals carry a warning', () => {
    const html = render({ status: 'ready', totals: { ...TOTALS, computedAt: NOW - 26 * 60_000 } }, list());
    expect(html).toContain('is-stale');
    expect(html).toContain('Обновлено 26 мин назад');
  });

  it('no access on 403', () => {
    const html = render({ status: 'forbidden' }, list({ items: [], nextCursor: null }));
    expect(html).toContain('правом управлять пулом');
    expect(html).not.toContain('Показать ещё');
  });
});
