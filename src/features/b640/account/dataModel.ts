import type { CandidateCapability } from '../../legal/capabilityConsents';

export interface ConsentRow {
  readonly capability: CandidateCapability;
  readonly title: string;
  /** Что разрешает согласие — одной строкой, как в макете N5. */
  readonly line: string;
}

/** Согласия, которые умеет хранить сервер. */
export const CONSENT_ROWS: readonly ConsentRow[] = [
  {
    capability: 'profile_activity',
    title: 'Подключённый профиль',
    line: 'Проверять, что данные профиля на площадке не устарели',
  },
  {
    capability: 'digital_footprint',
    title: 'Цифровой след',
    line: 'Проверять, что о вас видно в открытом доступе',
  },
  {
    capability: 'actions_on_behalf',
    title: 'Действия от вашего имени',
    line: 'Отправлять отклики, которые вы одобрили',
  },
];

export interface AutomationState {
  readonly enabled: boolean;
  readonly pausedUntil: string | null;
  /** Аварийная остановка: её снимают в «Откликах», не здесь. */
  readonly emergencyPaused: boolean;
}

export interface AutomationLine {
  readonly text: string;
  /** Что предложить в строке; `null` — останавливать нечего. */
  readonly action: 'stop' | 'resume' | null;
}

/** Строка «Автоотклики»: идут, остановлены или выключены. */
export function automationLine(state: AutomationState, now: Date = new Date()): AutomationLine {
  if (!state.enabled) return { text: 'выключены', action: null };
  const until = state.pausedUntil ? new Date(state.pausedUntil) : null;
  const paused = until !== null && until.getTime() > now.getTime();
  if (state.emergencyPaused) return { text: 'остановлены', action: null };
  return paused ? { text: 'остановлены', action: 'resume' } : { text: 'идут', action: 'stop' };
}
