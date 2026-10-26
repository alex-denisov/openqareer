import { useEffect, useSyncExternalStore } from 'react';

import {
  isGeoDirectoryReady,
  loadGeoDirectory,
  subscribeGeoDirectory,
} from '../../../shared/geo/geoDirectory';

export interface GeoDirectoryStatus {
  readonly ready: boolean;
  readonly failed: boolean;
}

/** Грузит справочник географии отдельным чанком; `ready` меняется один раз. */
export function useGeoDirectory(): GeoDirectoryStatus {
  const ready = useSyncExternalStore(subscribeGeoDirectory, isGeoDirectoryReady, () => false);
  const failed = useSyncExternalStore(
    subscribeFailure,
    () => loadFailed,
    () => false,
  );
  useEffect(() => {
    if (ready) return;
    // Сбой загрузки виден в интерфейсе: поле показывает «Справочник мест не загрузился».
    loadGeoDirectory().catch(() => {
      loadFailed = true;
      for (const listener of failureListeners) listener();
    });
  }, [ready]);
  return { ready, failed };
}

let loadFailed = false;
const failureListeners = new Set<() => void>();

function subscribeFailure(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}
