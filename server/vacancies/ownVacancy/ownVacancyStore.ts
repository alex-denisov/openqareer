import { SqliteOwnVacancyStore } from '../../data/sqliteOwnVacancyStore';
import type { RouteDeps } from '../../routes/deps';

/** B676: хранилище своих вакансий в базе расчёта совпадения; одно на процесс. */
const stores = new WeakMap<object, SqliteOwnVacancyStore>();

export function ownVacancyStoreFor(deps: Pick<RouteDeps, 'vacancyMechanics' | 'config'>): SqliteOwnVacancyStore | null {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return null;
  const known = stores.get(runtime);
  if (known) return known;
  const store = new SqliteOwnVacancyStore(runtime.database, deps.config.dataEncryptionKey);
  stores.set(runtime, store);
  return store;
}

/** Удаление аккаунта: свои вакансии уходят вместе с остальными данными кандидата. */
export function forgetOwnVacancies(deps: Pick<RouteDeps, 'vacancyMechanics' | 'config'>, candidateId: string): void {
  ownVacancyStoreFor(deps)?.deleteCandidate(candidateId);
}
