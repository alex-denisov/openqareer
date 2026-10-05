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

export interface DeliveryReceipt {
  readonly kind: 'confirmation_url' | 'auto_reply' | 'screenshot' | 'failure_note';
  readonly value: string;
}

export type DeliveryState = 'prepared' | 'attempted' | 'delivered' | 'failed';

/** `applied` means only attempted until evidence confirms its outcome. */
export function deliveryState(
  stage: ApplicationStage,
  receipt: DeliveryReceipt | null,
): DeliveryState {
  if (stage === 'saved') return 'prepared';
  if (!receipt) return 'attempted';
  return receipt.kind === 'failure_note' ? 'failed' : 'delivered';
}

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
export function canLegacyClientAdvanceToApplied(currentStage: ApplicationStage | null): boolean {
  return currentStage === null || currentStage === 'saved';
}

/**
 * Закрытая карточка (отказ или архив) больше не часть активного поиска:
 * её интервью не считаются ни в «Сегодня», ни в шкале пути (B293).
 */
export function isClosedApplicationStage(stage: ApplicationStage): boolean {
  return stage === 'rejected' || stage === 'archived';
}
