import { apiFetch, readData } from '../coach/apiClient';
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
