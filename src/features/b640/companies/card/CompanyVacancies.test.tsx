// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { mount, type Mounted } from '../../kit/testDom';
import { CompanyVacancies } from './CompanyVacancies';

vi.mock('../../shell/ShellContext', () => ({ useShell: () => ({ navigate: () => undefined }) }));
vi.mock('../../../vacancies/useCurrencyRates', () => ({
  useCurrencyRates: () => ({ date: '2026-11-10', rubPerUnit: { USD: 90, EUR: 98 } }),
}));

function item(id: string, extra: Record<string, unknown>): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: `Director ${id}`,
      canonicalCompany: 'Dooley Center',
      isRemote: true,
      primaryUrl: 'https://example.com/v',
      sources: [],
      firstObservedAt: '2026-11-17T08:00:00Z',
    },
    explanation: { clusterId: id, ...extra },
  } as unknown as MatchedVacancyItem;
}

const estimate = {
  marketSalary: {
    low: 5_000,
    high: 6_000,
    currency: 'USD',
    period: 'month',
    tax: 'unknown',
    computedAt: '2026-11-20T03:00:00.000Z',
  },
};

let view: Mounted | undefined;
afterEach(() => view?.unmount());

describe('CompanyVacancies: деньги как в подборке (B803)', () => {
  it('оценка в рублях с источником в title и скрытом тексте — и в «Других вакансиях»', () => {
    view = mount(
      <CompanyVacancies
        vacancies={[item('a', estimate)]}
        total={1}
        others={[item('b', estimate)]}
        othersTotal={1}
        applications={{}}
        moreBusy={false}
        moreFailed={false}
        onMore={() => undefined}
      />,
    );
    const money = [...view.container.querySelectorAll<HTMLElement>('[title*="Оценка openqareer"]')];
    expect(money).toHaveLength(2);
    for (const node of money) {
      expect(node.textContent).toMatch(/^≈ 450–540 тыс\. ₽/u);
      expect(node.title).toContain('Оценка openqareer, 20.11');
      expect(node.querySelector('.vh')?.textContent).toContain('Оценка openqareer, 20.11');
    }
    expect(view.container.textContent).not.toContain('В вакансии');
  });
});
