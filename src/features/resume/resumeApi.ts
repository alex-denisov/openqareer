import { apiFetch, readData } from '../coach/apiClient';
import type { ParsedResume } from '../workspace/resumeParser';
import type { ResumeStudioView } from './resumeTypes';
import type { ResumeDraft } from './resumeTypes';

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

export type ResumeImportSource = 'pdf' | 'linkedin' | 'hh' | 'text';

export interface ResumeImportResult {
  readonly parsed: ParsedResume;
  readonly resume: ResumeStudioView;
  /** `model` when the provider structured the document, `rules` on the fallback. */
  readonly structuredBy: 'model' | 'rules';
  readonly factCount: number;
}

/**
 * Hands one extracted document to the server, which reads it, records what it
 * stated as confirmed dossier evidence and saves the resume draft that cites
 * those facts. Doing all three server-side is what makes an import visible in
 * Resume Studio instead of silently dropped (B148).
 */
export async function importCandidateResume(input: {
  text: string;
  source: ResumeImportSource;
  fileName?: string;
}): Promise<ResumeImportResult> {
  const response = await apiFetch('/api/v1/candidate/resume/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      source: input.source,
      ...(input.fileName ? { fileName: input.fileName } : {}),
    }),
  });
  return readData<ResumeImportResult>(response);
}
