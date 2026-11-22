import type { CandidateCapability } from '../../legal/capabilityConsents';

export interface ConsentRow {
  readonly capability: CandidateCapability;
  readonly title: string;
  /** Что разрешает согласие — одной строкой, как в макете N5. */
  readonly line: string;
  /** Отзыв стирает данные на сервере: вопрос и одна фраза для окна подтверждения. */
  readonly revokeWarning?: { readonly title: string; readonly text: string };
}

/** «Вы в поиске» (B263) — первая строка n05, как в макете; хранится отдельно от `me/consents`. */
export const SEARCH_CONSENT_ROW = {
  title: '«Вы в поиске»',
  line: 'Разрешает искать рекрутеров и тёплые пути',
} as const;

/**
 * Согласия `me/consents` в порядке макета N5: «Цифровой след», затем согласия,
 * которых в макете нет, но у них есть механика (решение оркестратора 22.11).
 * `actions_on_behalf` назван по делу — «Отклики и подъём резюме», чтобы не
 * повторять заголовок раздела «Действия от вашего имени» ниже.
 */
export const CONSENT_ROWS: readonly ConsentRow[] = [
  {
    capability: 'digital_footprint',
    title: 'Цифровой след',
    line: 'Проверять, что о вас видно в открытом доступе',
    // server/routes/capabilityConsentRoutes.ts: при отзыве удаляются проверки следа.
    revokeWarning: {
      title: 'Отозвать согласие на цифровой след?',
      text: 'Сохранённые проверки и находки удалятся.',
    },
  },
  {
    capability: 'profile_activity',
    title: 'Подключённый профиль',
    line: 'Проверять, что данные профиля на площадке не устарели',
  },
  {
    capability: 'actions_on_behalf',
    title: 'Отклики и подъём резюме',
    line: 'Отправлять одобренные вами отклики и поднимать резюме',
  },
];

export interface AutomationState {
  readonly enabled: boolean;
  readonly pausedUntil: string | null;
  /** Аварийная остановка: её снимают в «Откликах», не здесь. */
  readonly emergencyPaused: boolean;
  /** B695: ждущие посты очереди LinkedIn; их напоминания останавливает та же пауза. */
  readonly scheduledPosts: number;
}

export interface AutomationLine {
  readonly text: string;
  /** Что предложить в строке; `null` — останавливать нечего. */
  readonly action: 'stop' | 'resume' | null;
}

/**
 * Строка «Автоотклики, комментарии в LinkedIn»: идут, остановлены или выключены. Остановить есть что,
 * если включены автоотклики или в очереди LinkedIn ждут посты (B695).
 */
export function automationLine(state: AutomationState, now: Date = new Date()): AutomationLine {
  if (!state.enabled && state.scheduledPosts === 0) return { text: 'выключены', action: null };
  const until = state.pausedUntil ? new Date(state.pausedUntil) : null;
  const paused = until !== null && until.getTime() > now.getTime();
  if (state.emergencyPaused) return { text: 'остановлены', action: null };
  return paused ? { text: 'остановлены', action: 'resume' } : { text: 'идут', action: 'stop' };
}
