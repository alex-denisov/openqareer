/**
 * PRB-015 — ответ `429` обещал «повторите через минуту», а окно входа было
 * пятнадцатиминутным: пользователь, поверивший сообщению, получал отказ ещё
 * четырнадцать минут. Срок берётся из самого лимитера (`retry-after`), а не из
 * константы; если лимитер срок не назвал, сообщение его не выдумывает.
 */
const PREFIX = 'Слишком много запросов.';

function minuteWord(minutes: number): string {
  const lastTwo = minutes % 100;
  const last = minutes % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'минут';
  if (last === 1) return 'минуту';
  if (last >= 2 && last <= 4) return 'минуты';
  return 'минут';
}

export function rateLimitMessage(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return `${PREFIX} Повторите действие позже.`;
  }
  // Неполная минута округляется вверх: повторять раньше конца окна бесполезно.
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `${PREFIX} Повторите действие через ${minutes} ${minuteWord(minutes)}.`;
}

/** `retry-after` приходит заголовком: строкой, числом или не приходит вовсе. */
export function retryAfterSeconds(header: unknown): number | null {
  if (typeof header === 'number') return Number.isFinite(header) ? header : null;
  if (typeof header !== 'string') return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
