import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResumeAtsAssessment } from '../../../server/domain/resumeAtsAssessment';
import type { ResumeVersionSummary } from '../../../server/domain/resumeVersions';
import {
  getProfileAtsAssessment,
  getResumeAtsAssessment,
  type ResumeAtsAssessmentRequest,
} from './resumeVersionsApi';
import { apiErrorMessage } from '../coach/apiClient';

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
  if (requestKey === null) {
    // One round trip: the server picks the version and the Career role itself
    // (shared/atsBasis). Reading both first cost 1–2 s more on prod (03.11).
    const { assessment, basis } = await getProfileAtsAssessment(signal);
    return { assessment, sourceVersion: basis.version, roleBasis: basis.roleTitle };
  }
  const request = JSON.parse(requestKey) as ResumeAtsAssessmentRequest;
  return {
    assessment: await getResumeAtsAssessment(request, signal),
    sourceVersion: null,
    roleBasis: null,
  };
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
  cacheKey: () => string | null,
  set: AssessmentLoadSetters,
): () => void {
  const controller = new AbortController();
  let active = true;
  set.setLoading(true);
  set.setError(null);
  void loadProfileAssessment(requestKey, controller.signal)
    .then((result) => {
      if (!active) return;
      const key = cacheKey();
      if (key !== null) remember(key, result);
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
  const cached = refreshKey === null ? undefined : assessmentCache.get(cacheKey);
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
  const loadRevision = useLoadRevision(refreshKey);
  // The result is kept under the revision known when it lands, never under «not read yet».
  const latestCacheKey = useRef<string | null>(null);
  latestCacheKey.current = refreshKey === null ? null : cacheKey;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const set = { setAssessment, setSourceVersion, setRoleBasis, setLoading, setError };
    const key = latestCacheKey.current;
    const hit = refreshSequence === 0 && key !== null ? assessmentCache.get(key) : undefined;
    if (hit) {
      applyResult(hit, set);
      setError(null);
      setLoading(false);
      return;
    }
    return startAssessmentLoad(requestKey, () => latestCacheKey.current, set);
  }, [enabled, loadRevision, requestKey, refreshSequence]);

  useEffect(() => subscribeToVersionChanges(refresh), [refresh]);

  return { assessment, sourceVersion, roleBasis, loading, error, refresh };
}

/**
 * The assessment starts before the profile is read (prod 02.11: waiting for it
 * cost about a second). The first revision to arrive is the one that load is
 * already scoring, so only a later change starts another load.
 */
function useLoadRevision(refreshKey: string | null): string | null {
  const [first, setFirst] = useState(refreshKey);
  if (first === null && refreshKey !== null) setFirst(refreshKey);
  return refreshKey === null || refreshKey === first ? null : refreshKey;
}
