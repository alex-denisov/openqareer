import type { FactCorrectionProposal } from './factCorrection';

/**
 * B688: что ответ консультанта несёт кроме текста. Действия — только из закрытого
 * списка разделов кабинета; ссылка — только на запись профиля самого кандидата
 * (сервер оставляет записи, которые нашёл в его памяти, клиент — в своём снимке).
 */
export const CONSULTANT_REPLY_ACTIONS = ['profile', 'career', 'vacancies', 'responses'] as const;

export type ConsultantReplyAction = (typeof CONSULTANT_REPLY_ACTIONS)[number];

/** Не больше двух действий и трёх ссылок под одной репликой. */
export const CONSULTANT_REPLY_MAX_ACTIONS = 2;
export const CONSULTANT_REPLY_MAX_LINKS = 3;

export interface ConsultantReplyExtras {
  /** Реплика консультанта, под которой стоят действия и ссылки. */
  readonly messageId: string;
  readonly actions: readonly ConsultantReplyAction[];
  /** Записи профиля, на которые опирается ответ. */
  readonly memoryIds: readonly string[];
  /** B796: правки, которые кандидат назвал в своём вопросе; есть только под последней репликой. */
  readonly corrections?: readonly FactCorrectionProposal[];
}

export function isConsultantReplyAction(value: unknown): value is ConsultantReplyAction {
  return (CONSULTANT_REPLY_ACTIONS as readonly unknown[]).includes(value);
}
