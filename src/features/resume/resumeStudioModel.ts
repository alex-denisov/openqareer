import {
  isResumeEvidenceEligible,
  type ResumeEvidenceCandidate,
} from '../../../server/domain/resumeEvidenceEligibility';
import {
  buildResumeStudioProjection,
  type ResumeEvidence,
} from '../../../server/domain/resumeStudio';
import type { CandidateMemory } from '../coach/coachApi';
import type {
  ResumeDocument,
  ResumeDraft,
  ResumeStudioProjection,
  ResumeEducationInput,
  ResumeExperienceInput,
  ResumeLanguageInput,
  ResumeStudioView,
  ResumeUnknown,
  ResumeVariantId,
} from './resumeTypes';

/** Mirrors `resumeDraftSchema`; attaching more would be rejected on save. */
const MAX_BULLETS_PER_ROLE = 12;
const MAX_LINKS = 10;

export const EMPTY_DRAFT: ResumeDraft = {
  candidate: {},
  experience: [],
  education: [],
  languages: [],
};

export interface ResumeStatusSummary {
  readonly blocking: number;
  readonly open: number;
  readonly staleEvidence: number;
  readonly pages: number;
  readonly maxPages: number | null;
  readonly tone: 'blocked' | 'attention' | 'ready';
}

export function draftOf(view: ResumeStudioView): ResumeDraft {
  return view.draft ?? EMPTY_DRAFT;
}

/**
 * Rebuilds both documents from the draft in hand, using the same engine the
 * server runs. Without it an unknown would keep accusing the candidate of a gap
 * they just filled, because the projection would only refresh on save — and the
 * engine is a pure, dependency-free function, so running it here costs nothing
 * and cannot disagree with the server.
 */
export function previewProjection(
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
): ResumeStudioProjection {
  return buildResumeStudioProjection({
    ...draft,
    evidence: memory.map(
      (item): ResumeEvidence => ({
        id: item.id,
        kind: item.kind,
        status: item.status,
        statement: item.statement,
        sourceMessageIds: item.sourceMessageIds,
        sensitive: item.sensitive,
      }),
    ),
  });
}

export function selectDocument(
  projection: ResumeStudioProjection,
  variant: ResumeVariantId,
): ResumeDocument {
  return variant === 'germany' ? projection.germanyVariant : projection.master;
}

/**
 * Stale evidence outranks everything: a document whose approved fact no longer
 * exists must never read as ready, however complete it looks.
 */
export function summarizeResumeStudio(
  projection: ResumeStudioProjection,
  variant: ResumeVariantId,
  staleEvidence: number,
): ResumeStatusSummary {
  const document = selectDocument(projection, variant);
  const blocking = document.unknowns.filter((item) => item.blocking).length;
  const open = document.unknowns.length - blocking;
  return {
    blocking,
    open,
    staleEvidence,
    pages: document.length.pages,
    maxPages: document.conventions.maxPages,
    tone:
      blocking > 0 || staleEvidence > 0
        ? 'blocked'
        : open > 0
          ? 'attention'
          : 'ready',
  };
}

/** Blocking work first; the engine's own order is meaningful inside a group. */
export function orderUnknowns(
  unknowns: readonly ResumeUnknown[],
): readonly ResumeUnknown[] {
  return [
    ...unknowns.filter((item) => item.blocking),
    ...unknowns.filter((item) => !item.blocking),
  ];
}

/**
 * On a phone only the first screen is reliably seen, so the pane that opens is
 * the one carrying work rather than the prettier one.
 */
export function defaultMobilePane(
  projection: ResumeStudioProjection,
  variant: ResumeVariantId,
  staleEvidence: number,
): 'unknowns' | 'document' {
  const summary = summarizeResumeStudio(projection, variant, staleEvidence);
  return summary.blocking > 0 || summary.staleEvidence > 0
    ? 'unknowns'
    : 'document';
}

export function eligibleEvidence(
  memory: readonly CandidateMemory[],
): readonly CandidateMemory[] {
  return memory.filter((item) =>
    isResumeEvidenceEligible(item as ResumeEvidenceCandidate),
  );
}

export function updateCandidate(
  draft: ResumeDraft,
  patch: {
    fullName?: string;
    email?: string;
    phone?: string;
    location?: string;
    links?: readonly string[];
  },
): ResumeDraft {
  const contact = draft.candidate.contact ?? {};
  return {
    ...draft,
    candidate: {
      fullName: patch.fullName ?? draft.candidate.fullName,
      contact: {
        email: patch.email ?? contact.email,
        phone: patch.phone ?? contact.phone,
        location: patch.location ?? contact.location,
        links: (patch.links ?? contact.links ?? []).slice(0, MAX_LINKS),
      },
    },
  };
}

export function setTargetRole(draft: ResumeDraft, targetRole: string): ResumeDraft {
  return { ...draft, targetRole };
}

export function addExperience(
  draft: ResumeDraft,
  chronologyMemoryId: string,
): ResumeDraft {
  return {
    ...draft,
    experience: [
      ...draft.experience,
      {
        id: entryId(),
        chronologyMemoryId,
        current: false,
        bulletMemoryIds: [],
      },
    ],
  };
}

export function updateExperience(
  draft: ResumeDraft,
  id: string,
  patch: Partial<Omit<ResumeExperienceInput, 'id' | 'chronologyMemoryId'>>,
): ResumeDraft {
  return {
    ...draft,
    experience: draft.experience.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    ),
  };
}

export function removeExperience(draft: ResumeDraft, id: string): ResumeDraft {
  return {
    ...draft,
    experience: draft.experience.filter((entry) => entry.id !== id),
  };
}

export function toggleBullet(
  draft: ResumeDraft,
  experienceId: string,
  memoryId: string,
): ResumeDraft {
  return {
    ...draft,
    experience: draft.experience.map((entry) => {
      if (entry.id !== experienceId) return entry;
      const attached = entry.bulletMemoryIds.includes(memoryId);
      if (attached) {
        return {
          ...entry,
          bulletMemoryIds: entry.bulletMemoryIds.filter((id) => id !== memoryId),
        };
      }
      if (entry.bulletMemoryIds.length >= MAX_BULLETS_PER_ROLE) return entry;
      return { ...entry, bulletMemoryIds: [...entry.bulletMemoryIds, memoryId] };
    }),
  };
}

export function addEducation(
  draft: ResumeDraft,
  evidenceMemoryId: string,
): ResumeDraft {
  return {
    ...draft,
    education: [...draft.education, { id: entryId(), evidenceMemoryId }],
  };
}

export function updateEducation(
  draft: ResumeDraft,
  id: string,
  patch: Partial<Omit<ResumeEducationInput, 'id' | 'evidenceMemoryId'>>,
): ResumeDraft {
  return {
    ...draft,
    education: draft.education.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    ),
  };
}

export function removeEducation(draft: ResumeDraft, id: string): ResumeDraft {
  return { ...draft, education: draft.education.filter((entry) => entry.id !== id) };
}

export function addLanguage(
  draft: ResumeDraft,
  evidenceMemoryId: string,
): ResumeDraft {
  return {
    ...draft,
    languages: [...draft.languages, { id: entryId(), evidenceMemoryId }],
  };
}

export function updateLanguage(
  draft: ResumeDraft,
  id: string,
  patch: Partial<Omit<ResumeLanguageInput, 'id' | 'evidenceMemoryId'>>,
): ResumeDraft {
  return {
    ...draft,
    languages: draft.languages.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    ),
  };
}

export function removeLanguage(draft: ResumeDraft, id: string): ResumeDraft {
  return { ...draft, languages: draft.languages.filter((entry) => entry.id !== id) };
}

/**
 * A cleared input arrives as `''`, which the strict boundary schema rejects for
 * an email or URL. An emptied field means "unknown", so it is omitted and comes
 * back as a visible unknown instead of a validation error.
 */
export function toSavePayload(draft: ResumeDraft): ResumeDraft {
  return {
    candidate: {
      fullName: trimmed(draft.candidate.fullName),
      contact: {
        email: trimmed(draft.candidate.contact?.email),
        phone: trimmed(draft.candidate.contact?.phone),
        location: trimmed(draft.candidate.contact?.location),
        links: (draft.candidate.contact?.links ?? [])
          .map((link) => link.trim())
          .filter((link) => link.length > 0),
      },
    },
    targetRole: trimmed(draft.targetRole),
    experience: draft.experience.map((entry) => ({
      id: entry.id,
      chronologyMemoryId: entry.chronologyMemoryId,
      title: trimmed(entry.title),
      employer: trimmed(entry.employer),
      location: trimmed(entry.location),
      startDate: trimmed(entry.startDate),
      endDate: trimmed(entry.endDate),
      current: entry.current,
      bulletMemoryIds: [...entry.bulletMemoryIds],
    })),
    education: draft.education.map((entry) => ({
      id: entry.id,
      evidenceMemoryId: entry.evidenceMemoryId,
      institution: trimmed(entry.institution),
      qualification: trimmed(entry.qualification),
      startDate: trimmed(entry.startDate),
      endDate: trimmed(entry.endDate),
    })),
    languages: draft.languages.map((entry) => ({
      id: entry.id,
      evidenceMemoryId: entry.evidenceMemoryId,
      name: trimmed(entry.name),
      cefr: entry.cefr,
    })),
  };
}

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next && next.length > 0 ? next : undefined;
}

/** Matches `entryIdSchema`: leading alphanumeric, then alphanumeric/`_`/`-`. */
function entryId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `e${random}`;
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
