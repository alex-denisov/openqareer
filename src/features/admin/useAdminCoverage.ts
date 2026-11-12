import { useCallback, useEffect, useRef, useState } from 'react';
import { CoachApiError } from '../coach/apiClient';
import { getCoverageCompanies, getCoverageTotals, type CoverageFilter } from './coverageApi';
import type { AdminCoverageViewProps, CoverageListState, CoverageTotalsState } from './AdminCoverageView';

const MINUTE_MS = 60_000;
const EMPTY_LIST: CoverageListState = { filter: 'all', items: [], nextCursor: null, status: 'loading' };

function isForbidden(error: unknown): boolean {
  return error instanceof CoachApiError && (error.code === 'forbidden' || error.code === 'http_403');
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** B643-11: итоги и постраничный список; ответ устаревшего запроса не пишется. */
export function useAdminCoverage(): AdminCoverageViewProps {
  const [totals, setTotals] = useState<CoverageTotalsState>({ status: 'loading' });
  const [list, setList] = useState<CoverageListState>(EMPTY_LIST);
  const [now, setNow] = useState(() => Date.now());
  const listRequest = useRef<AbortController | null>(null);
  const totalsRequest = useRef<AbortController | null>(null);

  const loadTotals = useCallback(() => {
    totalsRequest.current?.abort();
    const controller = new AbortController();
    totalsRequest.current = controller;
    setTotals({ status: 'loading' });
    getCoverageTotals(controller.signal)
      .then((data) => {
        setNow(Date.now());
        setTotals({ status: 'ready', totals: data });
      })
      .catch((error: unknown) => {
        if (isAbort(error) || controller.signal.aborted) return;
        setTotals(
          isForbidden(error)
            ? { status: 'forbidden' }
            : { status: 'error', message: error instanceof Error ? error.message : 'unknown' },
        );
      });
  }, []);

  const loadPage = useCallback((filter: CoverageFilter, base: CoverageListState | null) => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    const start: CoverageListState = base ?? { filter, items: [], nextCursor: null, status: 'loading' };
    setList({ ...start, status: 'loading' });
    getCoverageCompanies({ filter, cursor: base?.nextCursor ?? null }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setList({ filter, items: [...start.items, ...page.items], nextCursor: page.nextCursor, status: 'ready' });
      })
      .catch((error: unknown) => {
        if (isAbort(error) || controller.signal.aborted) return;
        setList({ ...start, status: 'error' });
      });
  }, []);

  useEffect(() => {
    loadTotals();
    loadPage('all', null);
    const tick = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => {
      window.clearInterval(tick);
      totalsRequest.current?.abort();
      listRequest.current?.abort();
    };
  }, [loadTotals, loadPage]);

  const onRefresh = useCallback(() => {
    loadTotals();
    loadPage(list.filter, null);
  }, [list.filter, loadPage, loadTotals]);

  const onFilter = useCallback((filter: CoverageFilter) => loadPage(filter, null), [loadPage]);
  const onMore = useCallback(() => loadPage(list.filter, list), [list, loadPage]);
  // Повтор после сбоя: первая страница, если строк ещё нет, иначе та же следующая.
  const onRetryList = useCallback(
    () => loadPage(list.filter, list.items.length > 0 ? list : null),
    [list, loadPage],
  );

  return { totals, list, now, onRefresh, onFilter, onMore, onRetryList };
}
