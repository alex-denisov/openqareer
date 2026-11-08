import { createHmac } from 'node:crypto';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import { buildResumeStudioProjection, buildTargetedResumeSlice } from '../domain/resumeStudio';
import { estimateResumePages } from '../domain/resumeTargetedVolume';
import type { ResumeVersionContent } from '../domain/resumeVersions';
import type { ResumeDocument, ResumeStudioProjection } from '../domain/resumeStudioTypes';
import type { RouteDeps } from './deps';

/** Мастер-резюме кандидата и его ревизия: из них строятся версии резюме под вакансию. */
export interface CandidateResumeMaster {
  readonly draft: ResumeDraft;
  readonly document: ResumeDocument;
  readonly projection: ResumeStudioProjection;
  readonly updatedAt: string | null;
  readonly revision: string;
}

type CandidateSnapshotOf = ReturnType<RouteDeps['candidateStore']['getSnapshot']>;

/** Мастер-документ из уже прочитанного снимка кандидата: тот же, что ляжет в версию резюме. */
export function masterProjectionOf(snapshot: CandidateSnapshotOf): ResumeStudioProjection {
  const draft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
  return buildResumeStudioProjection({ ...draft, evidence: snapshot.memory });
}

export function currentMaster(deps: RouteDeps, candidateId: string): CandidateResumeMaster {
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const stored = snapshot.resume;
  const draft = stored?.draft ?? EMPTY_RESUME_DRAFT;
  const projection = masterProjectionOf(snapshot);
  const revision = masterRevision(
    candidateId,
    draft,
    projection.evidenceSnapshot,
    deps.config.dataEncryptionKey,
  );
  return {
    draft,
    document: projection.master,
    projection,
    updatedAt: stored?.updatedAt ?? null,
    revision,
  };
}

export function masterRevision(
  candidateId: string,
  draft: ResumeDraft,
  evidence: ResumeStudioProjection['evidenceSnapshot'],
  key: Buffer,
): string {
  const payload = canonicalJson({ draft, evidence });
  return createHmac('sha256', key)
    .update(candidateId)
    .update('\u0000')
    .update(payload)
    .digest('base64url');
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return (
      '{' +
      entries.map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'null';
}

export function buildVersionContent(
  master: CandidateResumeMaster,
  title: string,
  requirements: readonly string[],
  status: 'draft' | 'approved' = 'draft',
): ResumeVersionContent {
  const slice = buildTargetedResumeSlice(master.document, { title, requirements });
  return {
    title: title.trim(),
    requirements: slice.requirements.map((item) => item.requirement),
    status,
    snapshot: estimateResumePages(slice),
  };
}
