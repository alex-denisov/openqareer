import type { SkipReasonId } from '../../../../shared/skipReasons';
import { createVacancySkip } from '../../applications/applicationsApi';
import { apiFetch } from '../../coach/apiClient';

/** Причины окна «Не подходит» из макета и их запись на сервере. */
export const HIDE_REASONS: ReadonlyArray<{ readonly id: SkipReasonId; readonly label: string }> = [
  { id: 'role-family', label: 'Не та роль' },
  { id: 'company', label: 'Не та компания или отрасль' },
  { id: 'comp-below', label: 'Зарплата ниже ожиданий' },
  { id: 'geo-format', label: 'Не подходят условия' },
  { id: 'stale', label: 'Неактуально или дубль' },
];

export async function hideVacancy(clusterId: string, reasonId: SkipReasonId): Promise<void> {
  await createVacancySkip({ clusterId, reasonId, origin: 'vacancy_card' });
}

/** Отмена скрытия: вакансия возвращается в подборку. */
export async function unhideVacancy(clusterId: string): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/vacancy-skips/${encodeURIComponent(clusterId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error('Не удалось вернуть вакансию');
}
