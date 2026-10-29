import { useCallback, useEffect, useState } from 'react';
import type { ResumeAtsAssessment } from '../../../server/domain/resumeAtsAssessment';
import type { ResumeVersionSummary } from '../../../server/domain/resumeVersions';
import {
  getResumeAtsAssessment,
  getResumeVersions,
  type ResumeAtsAssessmentRequest,
} from './resumeVersionsApi';
import { getRoleHypotheses } from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { roleAtsRequest } from './atsRoleBasis';

export const RESUME_VERSION_COLLECTION_CHANGED_EVENT =
  'openqareer:resume-version-collection-changed';

export interface ProfileAtsAssessmentState {
  readonly assessment: ResumeAtsAssessment | null;
  readonly sourceVersion: ResumeVersionSummary | null;
  /** Роль из «Карьеры», по которой считаны ключевые слова, когда версии под вакансию нет. */
  readonly roleBasis?: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  /** On-demand mode only: the candidate has not asked for a calculation yet. */
  readonly idle?: boolean;
}

export interface UseProfileAtsAssessmentOptions {
  readonly enabled?: boolean;
  /** Opening the profile must not write (D2): calculate only after an explicit action. */
  readonly onDemand?: boolean;
  readonly request?: ResumeAtsAssessmentRequest;
  readonly refreshKey?: string | null;
}

async function loadProfileAssessment(
  requestKey: string | null,
  signal: AbortSignal,
): Promise<{
  readonly assessment: ResumeAtsAssessment;
  readonly sourceVersion: ResumeVersionSummary | null;
  readonly roleBasis: string | null;
}> {
  let request: ResumeAtsAssessmentRequest;
  let sourceVersion: ResumeVersionSummary | null = null;
  let roleBasis: string | null = null;
  if (requestKey === null) {
    const versions = await getResumeVersions({ limit: 50, signal });
    sourceVersion =
      versions.items.find((item) => item.sourceMasterRevision === versions.currentMasterRevision) ??
      null;
    const byRole = sourceVersion ? null : await roleBasisOrNull(signal);
    roleBasis = byRole?.roleTitle ?? null;
    request = sourceVersion ? { versionId: sourceVersion.id } : (byRole?.request ?? {});
  } else {
    request = JSON.parse(requestKey) as ResumeAtsAssessmentRequest;
  }
  return {
    assessment: await getResumeAtsAssessment(request, signal),
    sourceVersion,
    roleBasis,
  };
}

/** Роли не прочитались — оценка остаётся без ключевых слов, как раньше, а не падает. */
async function roleBasisOrNull(signal: AbortSignal) {
  try {
    return roleAtsRequest(await getRoleHypotheses(signal));
  } catch {
    return null;
  }
}

function subscribeToVersionChanges(refresh: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handleChange = () => refresh();
  window.addEventListener(RESUME_VERSION_COLLECTION_CHANGED_EVENT, handleChange);
  return () => window.removeEventListener(RESUME_VERSION_COLLECTION_CHANGED_EVENT, handleChange);
}

interface AssessmentLoadSetters {
  readonly setAssessment: (value: ResumeAtsAssessment | null) => void;
  readonly setSourceVersion: (value: ResumeVersionSummary | null) => void;
  readonly setRoleBasis: (value: string | null) => void;
  readonly setLoading: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
}

/** Starts one assessment request; the returned cleanup aborts it. */
function startAssessmentLoad(requestKey: string | null, set: AssessmentLoadSetters): () => void {
  const controller = new AbortController();
  let active = true;
  set.setLoading(true);
  set.setAssessment(null);
  set.setSourceVersion(null);
  set.setRoleBasis(null);
  set.setError(null);
  void loadProfileAssessment(requestKey, controller.signal)
    .then((result) => {
      if (!active) return;
      set.setAssessment(result.assessment);
      set.setSourceVersion(result.sourceVersion);
      set.setRoleBasis(result.roleBasis);
    })
    .catch((reason: unknown) => {
      if (!active || controller.signal.aborted) return;
      set.setError(apiErrorMessage(reason, 'Не удалось обновить оценку ATS.'));
    })
    .finally(() => {
      if (active) set.setLoading(false);
    });
  return () => {
    active = false;
    controller.abort();
  };
}

export function useProfileAtsAssessment(
  options: UseProfileAtsAssessmentOptions = {},
): ProfileAtsAssessmentState {
  const { enabled: allowed = true, onDemand = false, request, refreshKey = null } = options;
  const requestKey = request === undefined ? null : JSON.stringify(request);
  const [assessment, setAssessment] = useState<ResumeAtsAssessment | null>(null);
  const [sourceVersion, setSourceVersion] = useState<ResumeVersionSummary | null>(null);
  const [roleBasis, setRoleBasis] = useState<string | null>(null);
  const [loading, setLoading] = useState(allowed && !onDemand);
  const [error, setError] = useState<string | null>(null);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [requested, setRequested] = useState(!onDemand);
  const enabled = allowed && requested;
  const bump = useCallback(() => setRefreshSequence((value) => value + 1), []);
  const refresh = useCallback(() => {
    setRequested(true);
    bump();
  }, [bump]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    return startAssessmentLoad(requestKey, {
      setAssessment,
      setSourceVersion,
      setRoleBasis,
      setLoading,
      setError,
    });
  }, [enabled, refreshKey, requestKey, refreshSequence]);

  useEffect(() => subscribeToVersionChanges(bump), [bump]);

  return {
    assessment,
    sourceVersion,
    roleBasis,
    loading,
    error,
    refresh,
    idle: allowed && !requested,
  };
}
