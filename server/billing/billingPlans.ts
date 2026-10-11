import type { PaidPlanId } from './robokassaGateway';

export interface BillingPlan {
  readonly id: PaidPlanId;
  readonly name: string;
  readonly amountKopecks: number;
  readonly currency: 'RUB';
  readonly interval: 'month';
}

export const BILLING_PLANS: Readonly<Record<PaidPlanId, BillingPlan>> = {
  basic: { id: 'basic', name: 'Basic', amountKopecks: 399_000, currency: 'RUB', interval: 'month' },
  pro: { id: 'pro', name: 'Pro', amountKopecks: 990_000, currency: 'RUB', interval: 'month' },
  max: { id: 'max', name: 'Max', amountKopecks: 3_990_000, currency: 'RUB', interval: 'month' },
};

export const PAID_PLAN_ORDER: readonly PaidPlanId[] = ['basic', 'pro', 'max'];

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return value === 'basic' || value === 'pro' || value === 'max';
}
