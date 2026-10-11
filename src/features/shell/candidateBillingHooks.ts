import { useCallback, useEffect, useState } from 'react';
import {
  getCandidateBillingReceipts,
  getCandidateBillingSummary,
  type CandidateBillingCancellation,
  type CandidateBillingReceipt,
  type CandidateBillingSummary,
} from './candidateBillingApi';

type LoadState = 'loading' | 'ready' | 'error';

export function useCandidateBillingSummary() {
  const [summary, setSummary] = useState<CandidateBillingSummary | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getCandidateBillingSummary()
      .then((nextSummary) => {
        if (!active) return;
        setSummary(nextSummary);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => { active = false; };
  }, [revision]);

  const retry = useCallback(() => {
    setState('loading');
    setRevision((current) => current + 1);
  }, []);
  const applyCancellation = useCallback((cancellation: CandidateBillingCancellation) => {
    setSummary((current) => current
      ? {
          ...current,
          currentPlan: cancellation.planId,
          subscription: {
            status: cancellation.status,
            currentPeriodEndsAt: cancellation.currentPeriodEndsAt,
            nextChargeAt: cancellation.nextChargeAt,
            autoRenew: cancellation.autoRenew,
          },
        }
      : current);
  }, []);

  return { summary, state, retry, applyCancellation };
}

export function useCandidateBillingReceipts() {
  const [receipts, setReceipts] = useState<readonly CandidateBillingReceipt[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getCandidateBillingReceipts({ limit: 20 })
      .then((page) => {
        if (!active) return;
        setReceipts(page.receipts);
        setNextCursor(page.nextCursor);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => { active = false; };
  }, [revision]);

  const retry = useCallback(() => {
    setState('loading');
    setReceipts([]);
    setNextCursor(null);
    setLoadMoreError(false);
    setRevision((current) => current + 1);
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const page = await getCandidateBillingReceipts({ cursor: nextCursor, limit: 20 });
      setReceipts((current) => [...current, ...page.receipts]);
      setNextCursor(page.nextCursor);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  return { receipts, nextCursor, state, loadingMore, loadMoreError, retry, loadMore };
}
