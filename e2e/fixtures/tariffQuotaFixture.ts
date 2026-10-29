/** B579: остаток квот тарифа в мок-кабинете — по сетке квот `server/billing/tariffQuotas.ts`. */
type FixtureQuotaPlan = 'free' | 'basic' | 'pro' | 'max';

const LIMITS: Record<FixtureQuotaPlan, readonly [number, number, number, number, number]> = {
  free: [20, 0, 30, 0, 0],
  basic: [100, 0, 300, 10, 0],
  pro: [500, 500, 1000, 30, 90],
  max: [2000, 2000, 3000, 100, 210],
};

const KEYS = [
  ['applications', 'Отклики с резюме и письмом'],
  ['auto_applications', 'Автоотклики'],
  ['coach_turns', 'Ходы консультанта'],
  ['interview_trainings', 'Тренировки интервью'],
  ['linkedin_drafts', 'Черновики LinkedIn'],
] as const;

export function tariffQuotaSummary(plan: FixtureQuotaPlan) {
  return {
    plan,
    unlimited: false,
    period: { startedAt: '2026-10-08T00:00:00.000Z', endsAt: '2026-11-08T00:00:00.000Z' },
    fitPercentLimit: plan === 'free' ? 300 : null,
    quotas: KEYS.map(([key, label], index) => {
      const limit = LIMITS[plan][index] ?? 0;
      const used = Math.min(limit, 3);
      return { key, label, limit, used, remaining: limit - used, upgradePlan: null };
    }),
  };
}
