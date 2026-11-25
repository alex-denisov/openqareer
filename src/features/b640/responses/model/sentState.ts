import type { ApplicationView } from '../../../applications/applicationsApi';
import { applicationReachedStage } from '../../../applications/pipelineAnalytics';

const AFTER_SENDING = ['applied', 'responded', 'interview', 'offer', 'rejected'] as const;

/**
 * B787: отклик ушёл компании. «Не откликаюсь» переводит черновик сразу в архив — он отправлен
 * не был. Архив без истории стадий (старые записи) по-прежнему считается отправленным.
 */
export function wasSent(application: ApplicationView): boolean {
  if (application.stage === 'saved') return false;
  if (application.stage !== 'archived' || application.appliedAt) return true;
  if (AFTER_SENDING.some((stage) => applicationReachedStage(application, stage))) return true;
  return !applicationReachedStage(application, 'saved');
}
