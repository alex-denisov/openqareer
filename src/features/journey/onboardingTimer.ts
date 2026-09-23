import { pluralRu } from '../../../shared/pluralRu';

/**
 * A client timestamp for the wizard's own start, so the "done" step can say
 * "4 минуты 40 секунд с начала" (onboarding.html step 6) without a server
 * round trip. B246 only needs the number for the acceptance measurement, not
 * a stored metric, so this stays in memory.
 */
export interface OnboardingTimer {
  readonly startedAt: number;
}

export function startOnboardingTimer(now: number = Date.now()): OnboardingTimer {
  return { startedAt: now };
}

export function formatOnboardingDuration(
  timer: OnboardingTimer,
  now: number = Date.now(),
): string {
  const totalSeconds = Math.max(0, Math.round((now - timer.startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const secondsPart = pluralRu(seconds, ['секунда', 'секунды', 'секунд']);
  if (minutes === 0) return secondsPart;
  const minutesPart = pluralRu(minutes, ['минута', 'минуты', 'минут']);
  return `${minutesPart} ${secondsPart}`;
}
