import type { RoleSkillAssessmentCurrent } from './roleSkillAssessmentApi';

/** B770: пока вакансии роли считаются, экран спрашивает сам — каждые 3 с, не больше 10 раз. */
export const COUNTING_INTERVAL_MS = 3_000;
export const COUNTING_ATTEMPTS = 10;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Читает проверку, пока сервер отвечает «считаем»; каждое такое состояние показывается на месте.
 * После последней попытки — обычная ошибка загрузки с «Повторить».
 */
export async function readUntilCounted(
  read: () => Promise<RoleSkillAssessmentCurrent>,
  onCounting: (current: RoleSkillAssessmentCurrent) => void,
): Promise<RoleSkillAssessmentCurrent> {
  for (let attempt = 1; ; attempt += 1) {
    const current = await read();
    if (current.state !== 'counting') return current;
    if (attempt >= COUNTING_ATTEMPTS) throw new Error('role_vacancies_still_counting');
    onCounting(current);
    await pause(COUNTING_INTERVAL_MS);
  }
}
