import { z } from 'zod';
import type { TargetedResumeVolume } from './resumeTargetedVolume';

export type ResumeVersionStatus = 'draft' | 'approved' | 'sent';

export interface ResumeVersionContent {
  readonly title: string;
  readonly requirements: readonly string[];
  readonly status: ResumeVersionStatus;
  readonly snapshot: TargetedResumeVolume;
}

export interface StoredResumeVersion extends ResumeVersionContent {
  readonly id: string;
  readonly revision: number;
  readonly sourceMasterRevision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ResumeVersionSummary = Omit<StoredResumeVersion, 'snapshot'>;

export interface ResumeVersionCursor {
  readonly updatedAt: string;
  readonly versionId: string;
}

export interface ResumeVersionPage {
  readonly items: readonly StoredResumeVersion[];
  readonly nextCursor: ResumeVersionCursor | null;
  readonly totalCount: number;
}

export type ResumeVersionCreateResult =
  | { readonly status: 'created' | 'replayed'; readonly version: StoredResumeVersion }
  | { readonly status: 'id_conflict' };

export type ResumeVersionUpdateResult =
  | { readonly status: 'updated'; readonly version: StoredResumeVersion }
  | {
      readonly status:
        | 'not_found'
        | 'revision_conflict'
        | 'source_conflict'
        | 'immutable';
    };

const resumeVersionStatusSchema = z.enum(['draft', 'approved', 'sent']);

export const resumeVersionContentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  requirements: z.array(z.string().trim().min(1).max(160)).max(50),
  status: resumeVersionStatusSchema,
  snapshot: z.custom<TargetedResumeVolume>(isTargetedResumeVolume, {
    message: 'Invalid targeted resume snapshot.',
  }),
});

export function isTargetedResumeVolume(value: unknown): value is TargetedResumeVolume {
  const volume = record(value);
  const document = record(volume?.document);
  const contact = record(document?.contact);
  const length = record(document?.length);
  if (
    !volume ||
    !document ||
    !contact ||
    !length ||
    (document.kind !== 'master' && document.kind !== 'country-role') ||
    !Array.isArray(document.experience) ||
    !Array.isArray(document.education) ||
    !Array.isArray(document.languages) ||
    !Array.isArray(document.unknowns) ||
    !Array.isArray(volume.requirements) ||
    !Array.isArray(volume.matchedRequirements) ||
    !Array.isArray(volume.missingRequirements) ||
    !Array.isArray(volume.detailedExperienceIds) ||
    !Array.isArray(volume.compressedExperienceIds) ||
    !Array.isArray(volume.highlightedProjectIds) ||
    !Array.isArray(volume.trimmed) ||
    typeof volume.pages !== 'number' ||
    typeof volume.estimatedPages !== 'number' ||
    typeof length.lines !== 'number' ||
    typeof length.pages !== 'number' ||
    typeof length.linesPerPage !== 'number' ||
    (volume.warning !== null && typeof volume.warning !== 'string')
  ) {
    return false;
  }
  return true;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
