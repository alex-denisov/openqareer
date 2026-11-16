import type { ApplicationView } from '../../../applications/applicationsApi';

/** Отклик для тестов раздела: отправлен 4 ноября, ждёт ответа компании. */
export function application(overrides: Partial<ApplicationView> = {}): ApplicationView {
  return {
    id: 'a1',
    candidateId: 'c1',
    clusterId: 'cluster-1',
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      title: 'Руководитель платформы',
      company: 'Арка Холдинг',
      url: 'https://hh.ru/vacancy/1',
      source: 'hh',
    },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-11-04T10:00:00.000Z',
    version: 1,
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-04T10:00:00.000Z',
    appliedAt: '2026-11-04T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    deliveryReceipt: null,
    deliveryReceiptRecordedAt: null,
    ...overrides,
  };
}
