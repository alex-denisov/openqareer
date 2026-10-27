import { apiFetch, readData } from '../coach/apiClient';
import type { ParsedResume } from '../workspace/resumeParser';
import type { ResumeStudioView } from './resumeTypes';
import type { ResumeDraft } from './resumeTypes';
import type { LinkedInProfileV2 } from '../../../shared/linkedinProfileV2';

/**
 * Reads the resume as it stands now. The server rebuilds both variants from the
 * current dossier on every read, so a fact revoked after the last save comes
 * back as stale evidence instead of surviving inside the document.
 */
export async function getResumeStudio(): Promise<ResumeStudioView> {
  const response = await apiFetch('/api/v1/candidate/resume');
  return readData<ResumeStudioView>(response);
}

/**
 * Saves the candidate-entered draft and, with it, approves the evidence
 * snapshot the documents were built from. This is why the interface never
 * autosaves: saving is the candidate's act of standing behind the facts.
 */
export async function saveResumeStudioDraft(
  draft: ResumeDraft,
): Promise<ResumeStudioView> {
  const response = await apiFetch('/api/v1/candidate/resume', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  return readData<ResumeStudioView>(response);
}

export type ResumeImportSource = 'pdf' | 'linkedin' | 'hh' | 'text' | 'builder';

export interface NativeSourceReceipt {
  readonly platform: 'hh' | 'linkedin';
  readonly accessMode: 'native_session_snapshot';
  readonly sourceUrl: string;
  readonly capturedAt: string;
}

export interface NativeSourceConnection {
  readonly platform: NativeSourceReceipt['platform'];
  readonly available: true;
  readonly status: 'connected';
  readonly accessMode: 'native_session_snapshot';
  readonly capabilities: ['resume_read'];
  readonly importsCareerHistory: true;
  readonly connectedAt: string;
  readonly lastImportedAt: string;
  readonly factCount: number;
}

export interface ResumeImportResult {
  readonly parsed: ParsedResume;
  readonly resume: ResumeStudioView;
  /** `model` when the provider structured the document, `rules` on the fallback. */
  readonly structuredBy: 'model' | 'rules';
  readonly factCount: number;
  readonly connection?: NativeSourceConnection;
  /** The platform was only connected: the profile comes from another one (23.10.2026). */
  readonly connectOnly?: true;
}

/** One import source per profile (owner, 23.10.2026). */
export type NativeImportMode = 'profile' | 'connect_only' | 'replace_profile';

type ResumeImportInput = {
  readonly text: string;
  readonly fileName?: string;
  /** Why a LinkedIn structured capture fell back to text — logged server-side (B266). */
  readonly structuredFallback?: 'extract_failed' | 'no_substance' | 'schema_rejected';
} & (
  | {
      readonly source: 'hh' | 'linkedin';
      readonly sourceReceipt?: NativeSourceReceipt;
      readonly importMode?: NativeImportMode;
    }
  | {
      readonly source: Exclude<ResumeImportSource, 'hh' | 'linkedin'>;
      readonly sourceReceipt?: never;
      readonly importMode?: never;
    }
);

/**
 * Hands one extracted document to the server, which reads it, records what it
 * stated as confirmed dossier evidence and saves the resume draft that cites
 * those facts. Doing all three server-side is what makes an import visible in
 * Resume Studio instead of silently dropped (B148).
 */
export async function importCandidateResume(input: ResumeImportInput): Promise<ResumeImportResult> {
  const response = await apiFetch('/api/v1/candidate/resume/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      source: input.source,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.sourceReceipt ? { sourceReceipt: input.sourceReceipt } : {}),
      ...(input.structuredFallback ? { structuredFallback: input.structuredFallback } : {}),
      ...(input.importMode ? { importMode: input.importMode } : {}),
    }),
  });
  return readData<ResumeImportResult>(response);
}

export interface StructuredResumeImportInput {
  readonly profile: LinkedInProfileV2;
  readonly extractorVersion: string;
  readonly sourceUrl: string;
  readonly capturedAt: string;
  /** Field paths the device removed to pass the schema — logged server-side (B266). */
  readonly droppedFields?: readonly string[];
  readonly importMode?: NativeImportMode;
}

export interface StructuredResumeImportResult {
  readonly resume: ResumeStudioView;
  readonly factCount: number;
  readonly connection?: NativeSourceConnection;
  readonly connectOnly?: true;
}

/**
 * `POST /candidate/resume/import/structured` (B265/B266). The DOM was
 * already parsed on the candidate's device — this never sends free text, and
 * the server never runs a model or a text reader over the payload.
 */
export async function importStructuredLinkedInProfile(
  input: StructuredResumeImportInput,
): Promise<StructuredResumeImportResult> {
  const response = await apiFetch('/api/v1/candidate/resume/import/structured', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 2,
      source: 'linkedin',
      extractorVersion: input.extractorVersion,
      sourceReceipt: {
        platform: 'linkedin',
        accessMode: 'native_session_snapshot',
        sourceUrl: input.sourceUrl,
        capturedAt: input.capturedAt,
      },
      profile: input.profile,
      ...(input.droppedFields?.length ? { droppedFields: input.droppedFields } : {}),
      ...(input.importMode ? { importMode: input.importMode } : {}),
    }),
  });
  return readData<StructuredResumeImportResult>(response);
}
