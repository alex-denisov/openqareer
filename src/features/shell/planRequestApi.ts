import { useEffect, useState } from 'react';
import { apiFetch, readData } from '../coach/apiClient';

export type PlanRequestId = 'consultant' | 'automation';

interface StoredPlanRequest {
  readonly planId: PlanRequestId;
  readonly createdAt: string;
}

export async function listPlanRequests(): Promise<StoredPlanRequest[]> {
  return readData<StoredPlanRequest[]>(await apiFetch('/api/v1/candidate/plan-requests'));
}

export async function createPlanRequest(planId: PlanRequestId): Promise<StoredPlanRequest> {
  const response = await apiFetch('/api/v1/candidate/plan-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId }),
  });
  return readData<StoredPlanRequest>(response);
}

export type PlanRequestState = 'idle' | 'sending' | 'sent' | 'failed';

/** Requests already stored on the server, and the send action for one more. */
export function usePlanRequests() {
  const [states, setStates] = useState<Readonly<Record<string, PlanRequestState>>>({});
  useEffect(() => {
    let alive = true;
    listPlanRequests()
      .then((stored) => {
        if (!alive) return;
        setStates(Object.fromEntries(stored.map((item) => [item.planId, 'sent' as const])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const send = (planId: PlanRequestId) => {
    setStates((current) => ({ ...current, [planId]: 'sending' }));
    createPlanRequest(planId)
      .then(() => setStates((current) => ({ ...current, [planId]: 'sent' })))
      .catch(() => setStates((current) => ({ ...current, [planId]: 'failed' })));
  };
  return { states, send };
}
