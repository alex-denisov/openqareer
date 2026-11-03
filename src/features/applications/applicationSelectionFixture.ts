import type { ApplicationView } from './applicationsApi';

/** One response row for the selection tests: `failed` gives it a «Не доставлено» receipt. */
export function selectionApplication(
  id: string,
  options: { readonly failed?: boolean; readonly stage?: ApplicationView['stage'] } = {},
): ApplicationView {
  return {
    id,
    candidateId: 'candidate-1',
    clusterId: `cluster-${id}`,
    stage: options.stage ?? 'applied',
    closedReason: null,
    processProfile: 'standard',
    vacancy: { title: `Role ${id}`, company: `Company ${id}`, url: '', source: 'hh' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-10-01T00:00:00.000Z',
    appliedAt: '2026-10-02T00:00:00.000Z',
    deliveryReceipt: options.failed
      ? { kind: 'failure_note', value: 'Не доставлено: резюме скрыто' }
      : null,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: false, resume: false },
    nearestInterview: null,
  } as ApplicationView;
}
