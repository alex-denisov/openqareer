/**
 * B718: пороги скорости в тестах (замер по часам: «1000 откликов быстрее секунды»).
 *
 * В CI порог прежний — скорость проверяется как раньше. Локально хост делят несколько
 * сессий, и тот же код под нагрузкой идёт в разы медленнее: порог умножается на
 * `LOCAL_TIME_BUDGET_FACTOR`, иначе локальный хук падает на чужих тестах.
 * `OPENQAREER_TIME_BUDGET_FACTOR` (число > 0) задаёт множитель явно, в том числе в CI.
 * Только для тестов.
 */
export const LOCAL_TIME_BUDGET_FACTOR = 5;
const FACTOR_VARIABLE = 'OPENQAREER_TIME_BUDGET_FACTOR';

type Env = Readonly<Record<string, string | undefined>>;

function inCi(env: Env): boolean {
  const value = env.CI;
  return value !== undefined && value !== '' && value !== 'false' && value !== '0';
}

export function timeBudgetFactor(env: Env = process.env): number {
  const raw = env[FACTOR_VARIABLE];
  const explicit = raw === undefined ? Number.NaN : Number(raw);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return inCi(env) ? 1 : LOCAL_TIME_BUDGET_FACTOR;
}

/** Порог в миллисекундах (или секундах) с учётом множителя среды. */
export function timeBudget(limit: number, env: Env = process.env): number {
  return limit * timeBudgetFactor(env);
}
