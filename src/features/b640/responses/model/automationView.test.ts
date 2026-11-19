import { describe, expect, it } from 'vitest';
import type { CandidateAutomationSnapshot } from '../../../automation/automationApi';
import type { TariffQuotaSummary } from '../../../tariffs/tariffQuotaApi';
import { buildAutomationView, consentsToGrant, pauseDays, splitDayLimit } from './automationView';

const NOW = new Date('2026-11-12T09:00:00.000Z');

function snapshot(overrides: {
  enabled?: boolean;
  pausedUntil?: string | null;
  consents?: readonly string[];
}): CandidateAutomationSnapshot {
  return {
    settings: {
      candidateId: 'c1',
      enabled: overrides.enabled ?? true,
      mode: 'approval_required',
      pausedUntil: overrides.pausedUntil ?? null,
      rules: { roles: ['Руководитель разработки'], minimumMatchPercent: 80, platforms: ['hh', 'linkedin'], excludeStopCompanies: true },
      updatedAt: null,
    },
    consents: (overrides.consents ?? ['drafts', 'send_after_approval', 'notifications']).map((key) => ({
      id: key, key, version: '1', text: '', acceptedAt: '', revokedAt: null,
    })),
    stopCompanies: [],
    queueCounts: {},
    deliveryStats: { sentToday: 12, failedWeek: 0, attemptedWeek: 0 },
    schedule: { dailyLimits: { hh: 20, linkedin: 10 } },
    schedulerRuntime: { emergencyPaused: false },
  } as unknown as CandidateAutomationSnapshot;
}

function quotas(limit: number): TariffQuotaSummary {
  return {
    plan: limit > 0 ? 'pro' : 'free',
    unlimited: false,
    period: null,
    quotas: [{ key: 'auto_applications', label: '', limit, used: 0, remaining: limit, upgradePlan: null }],
    fitPercentLimit: null,
  };
}

describe('B656: строка «Автоотклики»', () => {
  it('включены: счётчик дня и общий лимит', () => {
    const view = buildAutomationView(snapshot({}), quotas(500), NOW);
    expect(view).toMatchObject({ visible: true, on: true, sentToday: 12, dayLimit: 30, needsPlan: false });
  });

  it('пауза выключает переключатель', () => {
    const view = buildAutomationView(snapshot({ pausedUntil: '2026-11-20T00:00:00.000Z' }), quotas(500), NOW);
    expect(view.on).toBe(false);
  });

  it('без согласий строка есть, переключатель выключен и ждёт согласия (B645)', () => {
    const view = buildAutomationView(snapshot({ enabled: false, consents: [] }), quotas(500), NOW);
    expect(view).toMatchObject({ visible: true, on: false, consented: false });
    expect(buildAutomationView(snapshot({}), quotas(500), NOW).consented).toBe(true);
  });

  it('согласия выдаются только отметкой кандидата и только если их ещё нет', () => {
    const fresh = buildAutomationView(snapshot({ enabled: false, consents: [] }), quotas(500), NOW);
    expect(consentsToGrant(fresh, false)).toBeNull();
    expect(consentsToGrant(fresh, true)).toEqual(['drafts', 'send_after_approval', 'notifications']);
    expect(consentsToGrant(buildAutomationView(snapshot({}), quotas(500), NOW), true)).toBeNull();
  });

  it('тариф без автооткликов зовёт на Pro', () => {
    expect(buildAutomationView(snapshot({}), quotas(0), NOW).needsPlan).toBe(true);
  });

  it('делит дневной лимит между площадками', () => {
    expect(splitDayLimit(31, ['hh', 'linkedin'], { hh: 1, linkedin: 1 })).toEqual({ hh: 16, linkedin: 15 });
    expect(splitDayLimit(30, ['hh'], { hh: 1, linkedin: 7 })).toEqual({ hh: 30, linkedin: 7 });
  });

  it('считает дни паузы до даты', () => {
    expect(pauseDays('2026-11-14', NOW)).toBe(3);
    expect(pauseDays('2026-11-01', NOW)).toBeNull();
    expect(pauseDays('', NOW)).toBeNull();
  });
});
