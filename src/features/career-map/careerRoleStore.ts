import { useEffect, useSyncExternalStore } from 'react';
import type { ProposedRole } from '../../../shared/roleProposals';
import type { RolesSample } from './roleHypothesisAdapter';
import {
  acceptCareerRole,
  dismissCareerRoleOffer,
  readRoleHypothesesWithDecisions,
  rejectCareerRole,
} from './careerRoleApi';

/**
 * Роли «Карьеры» одним состоянием на страницу (B445): экран и предложение
 * консультанта в панели читают одно и то же, и «Принять» в панели сразу
 * меняет статус роли на экране без второго чтения ролей.
 */
export interface CareerRolesState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly roles: readonly ProposedRole[];
  readonly rejected: readonly string[];
  readonly offersDismissed: readonly string[];
  readonly acceptedTitle: string | null;
  readonly checkedTitles: readonly string[];
  readonly checkedSkills: Readonly<Record<string, readonly string[]>>;
  readonly sample: RolesSample | null;
  readonly actionError: string | null;
}

const INITIAL: CareerRolesState = {
  status: 'idle',
  roles: [],
  rejected: [],
  offersDismissed: [],
  acceptedTitle: null,
  checkedTitles: [],
  checkedSkills: {},
  sample: null,
  actionError: null,
};

let state: CareerRolesState = INITIAL;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function setState(patch: Partial<CareerRolesState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadCareerRoles(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && state.status === 'ready') return Promise.resolve();
  setState({ status: 'loading' });
  inflight = readRoleHypothesesWithDecisions()
    .then((read) =>
      setState({
        status: 'ready',
        roles: read.roles,
        rejected: read.decisions.rejected,
        offersDismissed: read.decisions.offersDismissed,
        acceptedTitle: read.acceptedTitle,
        checkedTitles: read.checkedTitles,
        checkedSkills: read.checkedSkills,
        sample: read.sample,
      }),
    )
    .catch(() => setState({ status: 'failed' }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function runAction(action: () => Promise<Partial<CareerRolesState>>): Promise<boolean> {
  setState({ actionError: null });
  try {
    setState(await action());
    return true;
  } catch (error) {
    setState({
      actionError: error instanceof Error ? error.message : 'Не сохранилось. Попробуйте ещё раз.',
    });
    return false;
  }
}

export function rejectRole(roleId: string): Promise<boolean> {
  return runAction(async () => {
    await rejectCareerRole(roleId);
    return { rejected: [...state.rejected, roleId] };
  });
}

export function dismissRoleOffer(roleId: string): Promise<boolean> {
  return runAction(async () => {
    await dismissCareerRoleOffer(roleId);
    return { offersDismissed: [...state.offersDismissed, roleId] };
  });
}

export function acceptRole(title: string): Promise<boolean> {
  return runAction(async () => ({ acceptedTitle: await acceptCareerRole(title) }));
}

/** Только для тестов: сбросить состояние между сценариями. */
export function resetCareerRolesStore(next: Partial<CareerRolesState> = {}): void {
  state = { ...INITIAL, ...next };
  inflight = null;
  listeners.forEach((listener) => listener());
}

export function useCareerRoles(enabled = true): CareerRolesState {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  useEffect(() => {
    if (enabled) void loadCareerRoles(true);
  }, [enabled]);
  return snapshot;
}
