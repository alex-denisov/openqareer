import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CareerDiaryOverview,
  CareerDiaryPage,
  CareerDiaryWorkplace,
  CareerDiaryWorkplaceInput,
  CareerDiaryWorkplacePatch,
} from '../../../shared/careerDiary';
import { apiErrorMessage, apiFetch, readData } from '../coach/apiClient';
import { getCareerDiaryOverview } from '../diary/careerDiaryApi';
import { getResumeStudio } from '../resume/resumeApi';
import {
  careerDiaryProfileRoleChange,
  hasCurrentProfileExperience,
  shouldShowCareerDiary,
  type CareerDiaryAccessContextValue,
  type CareerDiaryProfileExperience,
} from './careerDiaryAccess';

const DIARY_API = '/api/v1/candidate/career-diary';

interface CareerDiaryShellSnapshot {
  readonly overview: CareerDiaryOverview;
  readonly workplaces: readonly CareerDiaryWorkplace[];
  readonly profileExperience: CareerDiaryProfileExperience | null;
  readonly profileExperiences: readonly CareerDiaryProfileExperience[];
}

interface PendingDiaryCreation {
  readonly oldWorkplaceId: string;
  readonly idempotencyKey: string;
  readonly input: CareerDiaryWorkplaceInput;
  newWorkplaceId?: string;
}

async function listCareerDiaryWorkplaces(
  signal: AbortSignal,
): Promise<readonly CareerDiaryWorkplace[]> {
  const response = await apiFetch(`${DIARY_API}/workplaces?limit=100`, { signal });
  return (await readData<CareerDiaryPage<CareerDiaryWorkplace>>(response)).items;
}

async function createCareerDiaryWorkplace(
  input: CareerDiaryWorkplaceInput,
  idempotencyKey: string,
): Promise<CareerDiaryWorkplace> {
  const response = await apiFetch(`${DIARY_API}/workplaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  });
  return readData<CareerDiaryWorkplace>(response);
}

async function updateCareerDiaryWorkplace(
  workplaceId: string,
  patch: CareerDiaryWorkplacePatch,
): Promise<CareerDiaryWorkplace> {
  const response = await apiFetch(`${DIARY_API}/workplaces/${encodeURIComponent(workplaceId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return readData<CareerDiaryWorkplace>(response);
}

async function setPrimaryCareerDiaryWorkplace(workplaceId: string): Promise<CareerDiaryWorkplace> {
  const response = await apiFetch(
    `${DIARY_API}/workplaces/${encodeURIComponent(workplaceId)}/primary`,
    { method: 'PUT' },
  );
  return readData<CareerDiaryWorkplace>(response);
}

async function archiveCareerDiaryWorkplace(workplaceId: string): Promise<CareerDiaryWorkplace> {
  const response = await apiFetch(
    `${DIARY_API}/workplaces/${encodeURIComponent(workplaceId)}/archive`,
    { method: 'PUT' },
  );
  return readData<CareerDiaryWorkplace>(response);
}

async function loadCareerDiaryShellSnapshot(
  signal: AbortSignal,
): Promise<CareerDiaryShellSnapshot> {
  const [overview, workplaces, resume] = await Promise.all([
    getCareerDiaryOverview(signal),
    listCareerDiaryWorkplaces(signal),
    getResumeStudio().catch(() => null),
  ]);
  const profileExperiences = (resume?.draft?.experience ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    employer: item.employer,
    current: item.current,
    startDate: item.startDate,
    endDate: item.endDate,
  }));
  const sourceId = overview.primaryWorkplace?.sourceExperienceId;
  const linkedExperience = profileExperiences.find((item) => item.id === sourceId);
  const currentExperiences = profileExperiences.filter((item) => item.current && !item.endDate);
  const profileExperience =
    linkedExperience ?? (currentExperiences.length === 1 ? currentExperiences[0]! : null);
  return { overview, workplaces, profileExperience, profileExperiences };
}

function useCareerDiaryShellData(
  enabled: boolean,
  candidateId: string | undefined,
  refreshKey: number,
) {
  const [snapshot, setSnapshot] = useState<CareerDiaryShellSnapshot | null>(null);
  const [state, setState] = useState<CareerDiaryAccessContextValue['state']>(
    enabled && candidateId ? 'loading' : 'disabled',
  );
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (!enabled || !candidateId) {
      setSnapshot(null);
      setState('disabled');
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    let current = true;
    setState('loading');
    setError(null);
    void loadCareerDiaryShellSnapshot(controller.signal)
      .then((loaded) => {
        if (!current) return;
        setSnapshot(loaded);
        setState('ready');
      })
      .catch((reason: unknown) => {
        if (!current || controller.signal.aborted) return;
        setError(apiErrorMessage(reason, 'Не удалось проверить статус места работы.'));
        setState('error');
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [candidateId, enabled, refreshKey, revision]);

  return { snapshot, state, error, reload };
}

function useCareerDiaryMutationState(reload: () => void) {
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const runMutation = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setSaving(true);
      setMutationError(null);
      try {
        await action();
        reload();
        return true;
      } catch (reason) {
        setMutationError(apiErrorMessage(reason, 'Не удалось сохранить изменение дневника.'));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );
  return { saving, mutationError, runMutation };
}

function useCareerDiaryRoleActions(
  primaryWorkplace: CareerDiaryWorkplace | null,
  profileExperience: CareerDiaryProfileExperience | null,
  runMutation: (action: () => Promise<unknown>) => Promise<boolean>,
) {
  const profileRole = primaryWorkplace
    ? careerDiaryProfileRoleChange(primaryWorkplace, profileExperience)
    : null;
  const roleKey = primaryWorkplace && profileRole ? `${primaryWorkplace.id}:${profileRole}` : null;
  const [dismissedRoleKey, setDismissedRoleKey] = useState<string | null>(null);
  const profileRoleChange = roleKey && dismissedRoleKey !== roleKey ? profileRole : null;
  const dismissRoleChange = useCallback(() => {
    if (roleKey) setDismissedRoleKey(roleKey);
  }, [roleKey]);
  const updateCurrentDiaryRole = useCallback(async () => {
    if (!primaryWorkplace || !profileRole) return false;
    return runMutation(() =>
      updateCareerDiaryWorkplace(primaryWorkplace.id, {
        title: profileRole,
        ...(profileExperience?.employer ? { company: profileExperience.employer } : {}),
      }),
    );
  }, [primaryWorkplace, profileExperience?.employer, profileRole, runMutation]);
  return { profileRole, profileRoleChange, dismissRoleChange, updateCurrentDiaryRole };
}

function useCareerDiaryNewPlaceAction(
  primaryWorkplace: CareerDiaryWorkplace | null,
  profileExperience: CareerDiaryProfileExperience | null,
  profileRole: string | null,
  runMutation: (action: () => Promise<unknown>) => Promise<boolean>,
) {
  const pendingCreation = useRef<PendingDiaryCreation | null>(null);
  return useCallback(
    async (startDate: string): Promise<boolean> => {
      if (!primaryWorkplace || !profileRole) return false;
      return runMutation(async () => {
        const pending =
          pendingCreation.current ??
          beginDiaryCreation(primaryWorkplace, profileExperience, profileRole, startDate);
        pendingCreation.current = pending;
        if (!pending.newWorkplaceId) {
          pending.newWorkplaceId = (
            await createCareerDiaryWorkplace(pending.input, pending.idempotencyKey)
          ).id;
        }
        await setPrimaryCareerDiaryWorkplace(pending.newWorkplaceId);
        await archiveCareerDiaryWorkplace(pending.oldWorkplaceId);
        pendingCreation.current = null;
      });
    },
    [primaryWorkplace, profileExperience, profileRole, runMutation],
  );
}

function beginDiaryCreation(
  primaryWorkplace: CareerDiaryWorkplace,
  profileExperience: CareerDiaryProfileExperience | null,
  profileRole: string,
  startDate: string,
): PendingDiaryCreation {
  return {
    oldWorkplaceId: primaryWorkplace.id,
    idempotencyKey: crypto.randomUUID(),
    input: {
      company: profileExperience?.employer?.trim() || primaryWorkplace.company,
      title: profileRole,
      startDate,
      sourceExperienceId: null,
    },
  };
}

function useCareerDiaryPrimaryAction(
  runMutation: (action: () => Promise<unknown>) => Promise<boolean>,
) {
  return useCallback(
    (workplaceId: string) => runMutation(() => setPrimaryCareerDiaryWorkplace(workplaceId)),
    [runMutation],
  );
}

function useCreateDiaryFromProfileAction(
  profileExperiences: readonly CareerDiaryProfileExperience[],
  runMutation: (action: () => Promise<unknown>) => Promise<boolean>,
) {
  return useCallback(
    async (input: CareerDiaryWorkplaceInput): Promise<boolean> => {
      const sourceExperienceId = input.sourceExperienceId ?? null;
      if (
        !sourceExperienceId ||
        !profileExperiences.some((item) => item.id === sourceExperienceId)
      ) {
        return false;
      }
      return runMutation(async () => {
        const created = await createCareerDiaryWorkplace(input, crypto.randomUUID());
        await setPrimaryCareerDiaryWorkplace(created.id);
      });
    },
    [profileExperiences, runMutation],
  );
}

export function useCareerDiaryShellAccess(
  enabled: boolean,
  candidateId: string | undefined,
  refreshKey: number,
) {
  const data = useCareerDiaryShellData(enabled, candidateId, refreshKey);
  const mutation = useCareerDiaryMutationState(data.reload);
  const primaryWorkplace = data.snapshot?.overview.primaryWorkplace ?? null;
  const profileExperience = data.snapshot?.profileExperience ?? null;
  const profileExperiences = data.snapshot?.profileExperiences ?? [];
  const role = useCareerDiaryRoleActions(primaryWorkplace, profileExperience, mutation.runMutation);
  const startNewDiary = useCareerDiaryNewPlaceAction(
    primaryWorkplace,
    profileExperience,
    role.profileRole,
    mutation.runMutation,
  );
  const setPrimaryWorkplace = useCareerDiaryPrimaryAction(mutation.runMutation);
  const createDiaryFromProfile = useCreateDiaryFromProfileAction(
    profileExperiences,
    mutation.runMutation,
  );
  const isVisible = Boolean(
    data.state === 'ready' &&
    (shouldShowCareerDiary(
      primaryWorkplace,
      profileExperience,
      data.snapshot?.overview.asOf ?? '',
    ) ||
      hasCurrentProfileExperience(profileExperiences)),
  );

  return {
    state: data.state,
    primaryWorkplace,
    workplaces: data.snapshot?.workplaces ?? [],
    profileExperience,
    profileExperiences,
    profileRoleChange: role.profileRoleChange,
    isVisible,
    error: data.error,
    saving: mutation.saving,
    mutationError: mutation.mutationError,
    reload: data.reload,
    dismissRoleChange: role.dismissRoleChange,
    updateCurrentDiaryRole: role.updateCurrentDiaryRole,
    createDiaryFromProfile,
    startNewDiary,
    setPrimaryWorkplace,
  } satisfies CareerDiaryAccessContextValue;
}
