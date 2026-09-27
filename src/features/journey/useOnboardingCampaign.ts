import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { isCandidateRegion, type CandidateRegion } from '../workspace/candidateRegions';
import { putCandidateWorkspace } from '../coach/coachApi';
import {
  getCandidateCampaign,
  rebuildCandidateCampaignRoles,
  saveCandidateCampaign,
  type CandidateCampaignUpdate,
} from '../coach/matchedVacancyApi';
import type { WorkspaceInput } from '../workspace/workspaceStorage';
import { rebuildAndWaitForModelCampaign } from './onboardingCampaign';
import { campaignRolesFromMeta, findCampaignRoleByTitle } from './onboardingCampaignRoles';
import type { OnboardingCampaignRole, OnboardingCampaignState } from './onboardingCampaignTypes';

export interface UseOnboardingCampaignInput {
  readonly hasAccount: boolean;
  readonly profileRoleOptions: readonly OnboardingCampaignRole[];
  readonly regions: readonly CandidateRegion[];
  readonly setRegions: Dispatch<SetStateAction<readonly CandidateRegion[]>>;
  readonly buildWorkspaceInput: (primaryRole?: string) => WorkspaceInput;
}

interface CampaignSetters {
  readonly setRoles: Dispatch<SetStateAction<readonly OnboardingCampaignRole[]>>;
  readonly setSelectedRoleIds: Dispatch<SetStateAction<readonly string[]>>;
  readonly setState: Dispatch<SetStateAction<OnboardingCampaignState>>;
  readonly setStartedAt: Dispatch<SetStateAction<number>>;
  readonly setError: Dispatch<SetStateAction<string | undefined>>;
}

interface CampaignRunRefs {
  readonly runId: MutableRefObject<number>;
  readonly abortController: MutableRefObject<AbortController | null>;
}

function setProfileFallback(
  profileRoleOptions: readonly OnboardingCampaignRole[],
  setters: CampaignSetters,
  message?: string,
): void {
  setters.setRoles(profileRoleOptions);
  setters.setSelectedRoleIds(profileRoleOptions.map((role) => role.id));
  setters.setError(message);
  setters.setState('fallback');
}

function cancelCampaignRun(refs: CampaignRunRefs): void {
  refs.runId.current += 1;
  refs.abortController.current?.abort();
  refs.abortController.current = null;
}

function addCandidateRole(
  roles: readonly OnboardingCampaignRole[],
  setters: CampaignSetters,
  title: string,
): void {
  const normalized = title.trim();
  if (!normalized) return;
  const existing = findCampaignRoleByTitle(roles, normalized);
  if (existing) {
    setters.setSelectedRoleIds((current) =>
      current.includes(existing.id) ? current : [...current, existing.id],
    );
    return;
  }
  const id = `candidate-${Date.now()}`;
  setters.setRoles((current) => [...current, { id, title: normalized, source: 'candidate' }]);
  setters.setSelectedRoleIds((current) => [...current, id]);
}

function applyModelCampaign(
  campaign: Awaited<ReturnType<typeof getCandidateCampaign>>,
  input: UseOnboardingCampaignInput,
  setters: CampaignSetters,
): void {
  const roles = campaignRolesFromMeta(campaign);
  setters.setRoles(roles);
  setters.setSelectedRoleIds(roles.map((role) => role.id));
  setters.setError(undefined);
  setters.setState('model');
  const inferredRegions = campaign.regions.value.filter(isCandidateRegion);
  if (input.regions.length === 0 && inferredRegions.length > 0) input.setRegions(inferredRegions);
}

async function runCampaignRebuild(
  input: UseOnboardingCampaignInput,
  setters: CampaignSetters,
  refs: CampaignRunRefs,
): Promise<void> {
  cancelCampaignRun(refs);
  if (!input.hasAccount) {
    setProfileFallback(input.profileRoleOptions, setters, 'Войдите, чтобы получить роли модели и сохранить подборку.');
    return;
  }

  const controller = new AbortController();
  refs.abortController.current = controller;
  const currentRunId = ++refs.runId.current;
  setters.setError(undefined);
  setters.setState('loading');
  setters.setStartedAt(0);

  try {
    const result = await rebuildAndWaitForModelCampaign({
      persistProfile: (signal) => putCandidateWorkspace(input.buildWorkspaceInput(), signal),
      requestRebuild: rebuildCandidateCampaignRoles,
      readCampaign: getCandidateCampaign,
      waitOptions: { signal: controller.signal },
      onWaitStarted: () => setters.setStartedAt(Date.now()),
    });
    if (currentRunId !== refs.runId.current || controller.signal.aborted) return;
    if (result.status === 'timeout') {
      setProfileFallback(input.profileRoleOptions, setters);
      return;
    }
    applyModelCampaign(result.campaign, input, setters);
  } catch {
    if (currentRunId === refs.runId.current && !controller.signal.aborted) {
      setProfileFallback(
        input.profileRoleOptions,
        setters,
        'Не удалось получить роли модели. Продолжите с ролями из профиля.',
      );
    }
  } finally {
    if (refs.abortController.current === controller) refs.abortController.current = null;
  }
}

async function persistCampaignSelection(
  input: UseOnboardingCampaignInput,
  roles: readonly OnboardingCampaignRole[],
  selectedRoleIds: readonly string[],
  primaryRole?: string,
): Promise<void> {
  const payload: CandidateCampaignUpdate = {
    roles: roles
      .filter((role) => selectedRoleIds.includes(role.id))
      .map((role) => (role.source === 'model' ? { id: role.id, title: role.title } : role.title)),
    regions: input.regions,
    remoteOnly: false,
  };
  await putCandidateWorkspace(input.buildWorkspaceInput(primaryRole));
  await saveCandidateCampaign(payload);
}

export function useOnboardingCampaign(input: UseOnboardingCampaignInput) {
  const [roles, setRoles] = useState<readonly OnboardingCampaignRole[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<readonly string[]>([]);
  const [state, setState] = useState<OnboardingCampaignState>('loading');
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState<string>();
  const runId = useRef(0);
  const abortController = useRef<AbortController | null>(null);
  const setters = useMemo<CampaignSetters>(
    () => ({ setRoles, setSelectedRoleIds, setState, setStartedAt, setError }),
    [],
  );
  const refs = useMemo<CampaignRunRefs>(() => ({ runId, abortController }), []);

  const toggleRole = useCallback((roleId: string) => {
    setSelectedRoleIds((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId],
    );
  }, []);
  const addRole = useCallback(
    (title: string) => addCandidateRole(roles, setters, title),
    [roles, setters],
  );
  const startCampaignRebuild = useCallback(
    () => runCampaignRebuild(input, setters, refs),
    [input, setters, refs],
  );
  const cancel = useCallback(() => cancelCampaignRun(refs), [refs]);
  const persistSelection = useCallback(
    (selectedRoles = roles, selectedIds = selectedRoleIds, primaryRole?: string) =>
      persistCampaignSelection(input, selectedRoles, selectedIds, primaryRole),
    [input, roles, selectedRoleIds],
  );

  useEffect(
    () => () => cancelCampaignRun(refs),
    [refs],
  );

  return {
    roles,
    selectedRoleIds,
    state,
    startedAt,
    error,
    toggleRole,
    addRole,
    startCampaignRebuild,
    cancelCampaignRebuild: cancel,
    persistSelection,
  };
}
