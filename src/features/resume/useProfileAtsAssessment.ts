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
    // Both reads start together: one after the other they cost a full extra round (02.11 prod).
    const roles = roleBasisOrNull(signal);
    const versions = await getResumeVersions({ limit: 50, signal });
    sourceVersion =
      versions.items.find((item) => item.sourceMasterRevision === versions.currentMasterRevision) ??
      null;
    const byRole = sourceVersion ? null : await roles;
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

type AssessmentResult = Awaited<ReturnType<typeof loadProfileAssessment>>;

/**
 * The last result per request and profile revision. The assessment is a pure
 * read of the saved profile (no writes), so it runs on every Profile open
 * (owner, 02.11) and a reopen with an unchanged profile shows it at once.
 */
const assessmentCache = new Map<string, AssessmentResult>();
const ASSESSMENT_CACHE_LIMIT = 8;

function cacheKeyOf(requestKey: string | null, refreshKey: string | null): string {
  return `${requestKey ?? 'master'}|${refreshKey ?? ''}`;
}

function remember(key: string, result: AssessmentResult): void {
  assessmentCache.delete(key);
  assessmentCache.set(key, result);
  if (assessmentCache.size > ASSESSMENT_CACHE_LIMIT) {
    assessmentCache.delete(assessmentCache.keys().next().value as string);
  }
}

/** Test seam: forget cached results between cases. */
export function clearProfileAtsAssessmentCache(): void {
  assessmentCache.clear();
}

interface AssessmentLoadSetters {
  readonly setAssessment: (value: ResumeAtsAssessment | null) => void;
  readonly setSourceVersion: (value: ResumeVersionSummary | null) => void;
  readonly setRoleBasis: (value: string | null) => void;
  readonly setLoading: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
}

/** Starts one assessment request; the returned cleanup aborts it. */
function applyResult(result: AssessmentResult, set: AssessmentLoadSetters): void {
  set.setAssessment(result.assessment);
  set.setSourceVersion(result.sourceVersion);
  set.setRoleBasis(result.roleBasis);
}

function startAssessmentLoad(
  requestKey: string | null,
  cacheKey: string,
  set: AssessmentLoadSetters,
): () => void {
  const controller = new AbortController();
  let active = true;
  set.setLoading(true);
  set.setError(null);
  void loadProfileAssessment(requestKey, controller.signal)
    .then((result) => {
      if (!active) return;
      remember(cacheKey, result);
      applyResult(result, set);
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
  const { enabled = true, request, refreshKey = null } = options;
  const requestKey = request === undefined ? null : JSON.stringify(request);
  const cacheKey = cacheKeyOf(requestKey, refreshKey);
  const cached = assessmentCache.get(cacheKey);
  const [assessment, setAssessment] = useState<ResumeAtsAssessment | null>(
    cached?.assessment ?? null,
  );
  const [sourceVersion, setSourceVersion] = useState<ResumeVersionSummary | null>(
    cached?.sourceVersion ?? null,
  );
  const [roleBasis, setRoleBasis] = useState<string | null>(cached?.roleBasis ?? null);
  const [loading, setLoading] = useState(enabled && !cached);
  const [error, setError] = useState<string | null>(null);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const refresh = useCallback(() => setRefreshSequence((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const set = { setAssessment, setSourceVersion, setRoleBasis, setLoading, setError };
    const hit = refreshSequence === 0 ? assessmentCache.get(cacheKey) : undefined;
    if (hit) {
      applyResult(hit, set);
      setError(null);
      setLoading(false);
      return;
    }
    return startAssessmentLoad(requestKey, cacheKey, set);
  }, [enabled, cacheKey, requestKey, refreshSequence]);

  useEffect(() => subscribeToVersionChanges(refresh), [refresh]);

  return { assessment, sourceVersion, roleBasis, loading, error, refresh };
}
