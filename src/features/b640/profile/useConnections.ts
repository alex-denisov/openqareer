import { useEffect, useRef, useState } from 'react';
import type { B640ConnectionList } from '../../../../shared/b640Connections';
import { apiFetch, readData } from '../../coach/apiClient';
import { appendConnections } from './connectionsModel';

export const CONNECTIONS_STEP = 20;
const SEARCH_DELAY_MS = 300;
/** Подборка холодная: перечитываем, пока сервер её не достроит. */
const PENDING_DELAY_MS = 4_000;
const PENDING_ATTEMPTS = 5;

export interface ConnectionsCriteria {
  readonly search: string;
  readonly pool: boolean;
}

async function listConnections(
  criteria: ConnectionsCriteria,
  offset: number,
): Promise<B640ConnectionList> {
  const query = new URLSearchParams({
    limit: String(CONNECTIONS_STEP),
    offset: String(offset),
    pool: String(criteria.pool),
  });
  if (criteria.search) query.set('search', criteria.search);
  const response = await apiFetch(`/api/v1/candidate/b640/connections?${query.toString()}`, {
    method: 'GET',
  });
  return readData<B640ConnectionList>(response);
}

function useDebounced(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

/** Список по критериям: первая порция, «Показать ещё» и перечитывание, пока подборка считается. */
export function useConnections(query: string, pool: boolean) {
  const search = useDebounced(query.trim());
  const [list, setList] = useState<B640ConnectionList | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'first' | 'more' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pendingReads = useRef(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setBusy(false);
    setFailed(null);
    listConnections({ search, pool }, 0).then(
      (first) => {
        if (current === generation.current) setList(first);
      },
      () => {
        if (current === generation.current) setFailed('first');
      },
    );
    return () => {
      generation.current += 1;
    };
  }, [search, pool, attempt]);

  const pending = list?.selectionPending ?? false;
  useEffect(() => {
    if (!pending || pendingReads.current >= PENDING_ATTEMPTS) return undefined;
    const timer = setTimeout(() => {
      pendingReads.current += 1;
      setAttempt((value) => value + 1);
    }, PENDING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending, list]);

  async function more(): Promise<void> {
    if (busy || !list || list.nextOffset === null) return;
    const current = generation.current;
    setBusy(true);
    setFailed(null);
    try {
      const next = await listConnections({ search, pool }, list.nextOffset);
      if (current !== generation.current) return;
      setList({ ...next, items: appendConnections(list.items, next.items) });
    } catch {
      if (current === generation.current) setFailed('more');
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  return { list, busy, failed, more, retry: () => setAttempt((value) => value + 1) };
}
