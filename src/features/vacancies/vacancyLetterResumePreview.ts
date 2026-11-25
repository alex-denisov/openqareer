import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import { getResumeStudio } from '../resume/resumeApi';
import { formatResumeAsAtsText, formatTargetedResumeAsAtsText } from '../resume/resumeExport';
import { getResumeVersion } from '../resume/resumeVersionsApi';
import type { ResumeDocument } from '../resume/resumeTypes';
import { prepareVacancyLetterResume, type ApprovedVacancyLetterResult } from './vacancyLetterApi';

export type LetterResumePreviewKind = 'targeted' | 'master' | 'general' | 'none';

/** What the panel over the letter shows: the resume that goes with this response (B631). */
export interface LetterResumePreview {
  readonly kind: LetterResumePreviewKind;
  readonly title: string;
  /** Plain ATS text, the same artifact the profile exports; empty when there is nothing to show. */
  readonly text: string;
  /** Документ, из которого собран текст: лист страницы и файл PDF/DOCX строятся из него. */
  readonly document?: ResumeDocument;
  /** Показанная версия под вакансию. */
  readonly versionId?: string;
}

type ApprovedResume = NonNullable<ApprovedVacancyLetterResult['resume']>;

async function targetedPreview(versionId: string, signal?: AbortSignal) {
  const { version } = await getResumeVersion(versionId, signal);
  return {
    kind: 'targeted',
    title: 'Резюме под вакансию',
    text: formatTargetedResumeAsAtsText(version.snapshot),
    document: version.snapshot.document,
    versionId,
  } satisfies LetterResumePreview;
}

async function masterPreview(): Promise<LetterResumePreview> {
  const studio = await getResumeStudio();
  return {
    kind: 'master',
    title: 'Резюме',
    text: formatResumeAsAtsText(studio.projection.master, studio.draft ?? EMPTY_RESUME_DRAFT),
    document: studio.projection.master,
  };
}

const GENERAL: LetterResumePreview = { kind: 'general', title: 'Ваше общее резюме', text: '' };
const NONE: LetterResumePreview = { kind: 'none', title: 'Резюме', text: '' };

/**
 * The targeted version is prepared anew until the response is sent (B785): the server keeps the sent
 * one and attaches the fresh one to an approved response. The approved one is read when it fails.
 */
export async function loadLetterResumePreview(
  vacancyId: string,
  approved: ApprovedResume | null,
  signal?: AbortSignal,
): Promise<LetterResumePreview> {
  if (approved) {
    if (approved.kind === 'general') return GENERAL;
    if (!approved.versionId) return masterPreview();
    const fresh = await prepareVacancyLetterResume(vacancyId).catch(() => null);
    return targetedPreview(fresh?.versionId ?? approved.versionId, signal);
  }
  const prepared = await prepareVacancyLetterResume(vacancyId);
  if (!prepared.ready) return NONE;
  return prepared.versionId ? targetedPreview(prepared.versionId, signal) : masterPreview();
}
