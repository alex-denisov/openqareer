/**
 * Model calls the vacancy-mechanics worker keeps in flight (B510). Jobs are leased, so lanes never
 * take the same job, and every call still passes the B522 budget reservation: lanes change speed,
 * not spend. Three lanes at ~8 s per call gave ~10 fits a minute on prod (27.10): a queue of 6 834
 * took 11 hours. The worker is its own process, so its SQL never blocks the HTTP server.
 */
export const DEFAULT_VACANCY_MECHANICS_LANES = 12;
const MAX_LANES = 16;

export function vacancyMechanicsLanes(env: Record<string, string | undefined>): number {
  const raw = env.OPENQAREER_VACANCY_MECHANICS_LANES?.trim();
  if (!raw) return DEFAULT_VACANCY_MECHANICS_LANES;
  const lanes = Number(raw);
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > MAX_LANES)
    throw new Error(`OPENQAREER_VACANCY_MECHANICS_LANES must be an integer from 1 to ${MAX_LANES}`);
  return lanes;
}
