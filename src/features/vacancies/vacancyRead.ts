/**
 * Чтение пула не ждёт бесконечно.
 *
 * На проде `GET /api/v1/candidate/matched-vacancies` отдаёт заголовки `200` и
 * не отдаёт тело: соединение остаётся открытым минутами. Экран, который просто
 * ждёт промис, показывает «Читаем собранный пул вакансий…» вечно, и кандидат
 * не может отличить долгий ответ от мёртвого. Ожидание ограничено, а истёкшее
 * ожидание — такой же честный отказ, как ошибка сети.
 */
export const VACANCY_READ_TIMEOUT_MS = 20_000;

export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = VACANCY_READ_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
