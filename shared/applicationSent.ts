import type { ApplicationStage } from './applicationStage';

const AFTER_SENDING: readonly ApplicationStage[] = [
  'applied',
  'responded',
  'interview',
  'offer',
  'rejected',
];

export interface SentFacts {
  readonly stage: ApplicationStage;
  readonly appliedAt?: string | null;
  readonly archivePreviousStage?: ApplicationStage | null;
  readonly reachedStages?: readonly ApplicationStage[];
}

/**
 * B787: отклик ушёл компании. «Не откликаюсь» переводит черновик сразу в архив — он отправлен
 * не был. Архив без истории стадий (старые записи) по-прежнему считается отправленным.
 */
export function wasSent(application: SentFacts): boolean {
  if (application.stage === 'saved') return false;
  if (application.stage !== 'archived' || application.appliedAt) return true;
  const reached = (stage: ApplicationStage) =>
    application.archivePreviousStage === stage ||
    (application.reachedStages?.includes(stage) ?? false);
  return AFTER_SENDING.some(reached) || !reached('saved');
}
