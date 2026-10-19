import { useCallback, useEffect, useState } from 'react';
import type { ResumeAtsAssessment } from '../../../server/domain/resumeAtsAssessment';
import type { ResumeVersionSummary } from '../../../server/domain/resumeVersions';
import {
  getResumeAtsAssessment,
  getResumeVersions,
  type ResumeAtsAssessmentRequest,
} from './resumeVersionsApi';
import { getRoleHypotheses } from '../coach/coachApi';
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
}

export interface UseProfileAtsAssessmentOptions {
  readonly enabled?: boolean;
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

export function useProfileAtsAssessment(
  options: UseProfileAtsAssessmentOptions = {},
): ProfileAtsAssessmentState {
  const { enabled = true, request, refreshKey = null } = options;
  const requestKey = request === undefined ? null : JSON.stringify(request);
  const [assessment, setAssessment] = useState<ResumeAtsAssessment | null>(null);
  const [sourceVersion, setSourceVersion] = useState<ResumeVersionSummary | null>(null);
  const [roleBasis, setRoleBasis] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const refresh = useCallback(() => setRefreshSequence((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setAssessment(null);
    setSourceVersion(null);
    setRoleBasis(null);
    setError(null);
    void loadProfileAssessment(requestKey, controller.signal)
      .then((result) => {
        if (!active) return;
        setAssessment(result.assessment);
        setSourceVersion(result.sourceVersion);
        setRoleBasis(result.roleBasis);
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'Не удалось обновить оценку ATS.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, refreshKey, requestKey, refreshSequence]);

  useEffect(() => subscribeToVersionChanges(refresh), [refresh]);

  return { assessment, sourceVersion, roleBasis, loading, error, refresh };
}
