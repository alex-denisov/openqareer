import type { CandidateAutomationSnapshot } from '../../../automation/automationApi';
import type { TariffQuotaSummary } from '../../../tariffs/tariffQuotaApi';

export type AutomationPlatform = 'hh' | 'linkedin';

export const PLATFORM_LABELS: Readonly<Record<AutomationPlatform, string>> = {
  hh: 'hh.ru',
  linkedin: 'LinkedIn',
};

const REQUIRED_CONSENTS = ['drafts', 'send_after_approval', 'notifications'] as const;
export const DAY_LIMIT_MAX = 50;

export interface AutomationView {
  /** Строка видна всегда, когда настройки загрузились (B645: макет o01). */
  readonly visible: boolean;
  /** Согласия на черновики, отправку после одобрения и уведомления уже даны. */
  readonly consented: boolean;
  readonly on: boolean;
  readonly sentToday: number;
  readonly dayLimit: number;
  /** На тарифе нет автооткликов: лист зовёт на Pro. */
  readonly needsPlan: boolean;
  /** Согласие на отправку без одобрения уже дано: можно выбирать режим письма. */
  readonly canSendAtOnce: boolean;
  readonly consentKeys: readonly string[];
}

function activeConsents(snapshot: CandidateAutomationSnapshot): readonly string[] {
  return snapshot.consents.filter((consent) => consent.revokedAt === null).map((consent) => consent.key);
}

export function dayLimitOf(snapshot: CandidateAutomationSnapshot): number {
  const limits = snapshot.schedule.dailyLimits;
  return snapshot.settings.rules.platforms.reduce((total, platform) => total + (limits[platform] ?? 0), 0);
}

export function buildAutomationView(
  snapshot: CandidateAutomationSnapshot,
  quotas: TariffQuotaSummary | null,
  now: Date = new Date(),
): AutomationView {
  const consentKeys = activeConsents(snapshot);
  const consented = REQUIRED_CONSENTS.every((key) => consentKeys.includes(key));
  const pausedUntil = snapshot.settings.pausedUntil;
  const paused = pausedUntil !== null && new Date(pausedUntil).getTime() > now.getTime();
  const quota = quotas?.quotas.find((item) => item.key === 'auto_applications');
  return {
    visible: true,
    consented,
    on: snapshot.settings.enabled && !paused && !snapshot.schedulerRuntime.emergencyPaused,
    sentToday: snapshot.deliveryStats?.sentToday ?? 0,
    dayLimit: dayLimitOf(snapshot),
    needsPlan: quotas !== null && !quotas.unlimited && (quota?.limit ?? 0) === 0,
    canSendAtOnce: consentKeys.includes('automatic_submission'),
    consentKeys,
  };
}

/** Делит общий дневной лимит между выбранными площадками поровну, остаток — первой. */
export function splitDayLimit(
  total: number,
  platforms: readonly AutomationPlatform[],
  current: Readonly<Record<AutomationPlatform, number>>,
): Record<AutomationPlatform, number> {
  if (platforms.length === 0) return { ...current };
  const base = Math.floor(total / platforms.length);
  const extra = total - base * platforms.length;
  return platforms.reduce<Record<AutomationPlatform, number>>(
    (acc, platform, index) => ({ ...acc, [platform]: base + (index < extra ? 1 : 0) }),
    { ...current },
  );
}

/** Сколько дней паузы до выбранной даты включительно; null — дата не подходит. */
export function pauseDays(until: string, now: Date = new Date()): number | null {
  const end = new Date(`${until}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  const days = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
  return days >= 1 && days <= 365 ? days : null;
}

/** Какие согласия выдать при сохранении листа; null — выдавать нечего или кандидат не отметил. */
export function consentsToGrant(view: AutomationView, accepted: boolean): readonly string[] | null {
  return !view.consented && accepted ? [...REQUIRED_CONSENTS] : null;
}
