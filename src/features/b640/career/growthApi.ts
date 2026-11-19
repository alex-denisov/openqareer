import { apiFetch, readData } from '../../coach/apiClient';
import type { ProfessionWage } from './professionPathApi';

const GROWTH_API = '/api/v1/candidate/career/growth';

export type GrowthGoalKind = 'promotion' | 'raise' | 'other_role' | 'stay';

export interface GrowthStep {
  readonly title: string;
  readonly sub: string;
  readonly state: 'done' | 'now' | 'next';
  readonly source: string;
}

export interface GrowthArgument {
  readonly id: string;
  readonly text: string;
  readonly date: string;
  readonly weekStart: string;
  readonly source: string;
}

export interface GrowthGoal {
  readonly kind: GrowthGoalKind;
  readonly chosenAt: string;
}

export type GrowthData =
  | { readonly state: 'no_workplace' }
  | { readonly state: 'no_goal'; readonly company: string; readonly title: string }
  | {
      readonly state: 'ready';
      readonly company: string;
      readonly title: string;
      readonly goal: GrowthGoal;
      readonly steps: readonly GrowthStep[];
      readonly arguments: readonly GrowthArgument[];
      readonly wage: ProfessionWage | null;
    };

export async function loadGrowth(signal: AbortSignal): Promise<GrowthData> {
  return readData<GrowthData>(await apiFetch(GROWTH_API, { signal }));
}

export async function saveGrowthGoal(goal: GrowthGoalKind): Promise<GrowthGoal> {
  const response = await apiFetch(`${GROWTH_API}/goal`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal }),
  });
  return (await readData<{ goal: GrowthGoal }>(response)).goal;
}
