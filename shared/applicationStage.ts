/**
 * Этапы трекера откликов (B251, S1, вариант B из architecture.md §3).
 *
 * `saved` покрывает и «Хочу», и «сохранено» — на входе в воронку различие
 * не нужно ни разу. Ручной переход между любыми этапами разрешён всегда:
 * кандидат вправе исправить ошибку в обе стороны, каждая смена пишется в
 * `application_events`. Единственное место, где направление ограничено, —
 * дубль старого клиента (`registerLegacyAppliedTransition`): он не имеет
 * права откатить карточку назад.
 */

export const APPLICATION_STAGES = [
  'saved',
  'applied',
  'responded',
  'interview',
  'offer',
  'rejected',
  'archived',
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export function isKnownApplicationStage(value: string): value is ApplicationStage {
  return (APPLICATION_STAGES as readonly string[]).includes(value);
}

/**
 * Может ли дубль старого `.app` (`POST /vacancy-applications`, `status:
 * 'applied'`) поднять карточку до `applied`.
 *
 * Разрешено только из пустого состояния (карточки ещё нет) или из `saved`:
 * старый клиент не знает про `interview`/`offer`/`rejected`/`archived`, и
 * его клик не имеет права откатить продвинувшуюся карточку обратно к
 * «Откликнулся» (architecture.md §4).
 */
export function canLegacyClientAdvanceToApplied(
  currentStage: ApplicationStage | null,
): boolean {
  return currentStage === null || currentStage === 'saved';
}
