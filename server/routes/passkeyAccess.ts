import { PasskeyStore } from '../auth/passkeyStore';
import type { RouteDeps } from './deps';

const stores = new WeakMap<RouteDeps['config'], PasskeyStore>();

/** Одно хранилище ключей на конфигурацию приложения; закрывается вместе с ним. */
export function passkeyStoreFor(deps: Pick<RouteDeps, 'config'>): PasskeyStore {
  const existing = stores.get(deps.config);
  if (existing) return existing;
  const store = new PasskeyStore({ databasePath: deps.config.databasePath });
  stores.set(deps.config, store);
  return store;
}

export function closePasskeyStoreFor(deps: Pick<RouteDeps, 'config'>): void {
  stores.get(deps.config)?.close();
  stores.delete(deps.config);
}
