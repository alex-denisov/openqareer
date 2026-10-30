import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TariffQuotaList } from './TariffQuotaPanel';
import { isQuotaLow, quotaNoteText } from './TariffQuotaNote';
import type { TariffQuotaSummary } from './tariffQuotaApi';

const freeSummary: TariffQuotaSummary = {
  plan: 'free',
  unlimited: false,
  period: { startedAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' },
  fitPercentLimit: 300,
  quotas: [
    {
      key: 'applications',
      label: 'Отклики с резюме и письмом',
      limit: 20,
      used: 2,
      remaining: 18,
      upgradePlan: 'basic',
    },
    {
      key: 'auto_applications',
      label: 'Автоотклики',
      limit: 0,
      used: 0,
      remaining: 0,
      upgradePlan: 'pro',
    },
    {
      key: 'coach_turns',
      label: 'Ходы консультанта',
      limit: 30,
      used: 30,
      remaining: 0,
      upgradePlan: 'basic',
    },
    {
      key: 'interview_trainings',
      label: 'Тренировки интервью',
      limit: 0,
      used: 0,
      remaining: 0,
      upgradePlan: 'basic',
    },
    {
      key: 'linkedin_drafts',
      label: 'Черновики LinkedIn',
      limit: 0,
      used: 0,
      remaining: 0,
      upgradePlan: 'pro',
    },
  ],
};

describe('остаток квот тарифа (B579)', () => {
  it('на экране «Тарифы» показывает только квоты тарифа, дату обновления и предел процента совпадения', () => {
    const html = renderToStaticMarkup(<TariffQuotaList summary={freeSummary} />);
    expect(html).toContain('Остаток в этом месяце');
    expect(html).toContain('обновится 1 ноября');
    expect(html).toContain('Отклики с резюме и письмом');
    expect(html).toContain('18 из 20');
    expect(html).toContain('0 из 30');
    expect(html).toContain('первые 300 вакансий');
    expect(html).not.toContain('Автоотклики');
    expect(html).not.toContain('Тренировки интервью');
  });

  it('строка у места траты называет остаток или тариф, где квоты больше', () => {
    const [applications, , coach] = freeSummary.quotas;
    expect(quotaNoteText(applications!)).toBe(
      'Отклики с резюме и письмом: осталось 18 из 20 в этом месяце',
    );
    expect(quotaNoteText(coach!)).toBe(
      'Ходы консультанта: квота месяца исчерпана. Больше — на тарифе Basic.',
    );
  });

  it('у консультанта строка видна, только когда осталось не больше 10 % (блок A, 30.10)', () => {
    const coach = freeSummary.quotas[2]!;
    expect(isQuotaLow({ ...coach, limit: 3000, used: 34, remaining: 2966 })).toBe(false);
    expect(isQuotaLow({ ...coach, limit: 30, used: 26, remaining: 4 })).toBe(false);
    expect(isQuotaLow({ ...coach, limit: 30, used: 27, remaining: 3 })).toBe(true);
    expect(isQuotaLow(coach)).toBe(true);
  });
});
