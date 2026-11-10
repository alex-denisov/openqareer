import { EMPTY_RESUME_DRAFT } from '../../../server/domain/resumeDraft';
import { getResumeStudio } from '../resume/resumeApi';
import { formatResumeAsAtsText, formatTargetedResumeAsAtsText } from '../resume/resumeExport';
import { getResumeVersion } from '../resume/resumeVersionsApi';
import { prepareVacancyLetterResume, type ApprovedVacancyLetterResult } from './vacancyLetterApi';

export type LetterResumePreviewKind = 'targeted' | 'master' | 'general' | 'none';

/** What the panel over the letter shows: the resume that goes with this response (B631). */
export interface LetterResumePreview {
  readonly kind: LetterResumePreviewKind;
  readonly title: string;
  /** Plain ATS text, the same artifact the profile exports; empty when there is nothing to show. */
  readonly text: string;
}

type ApprovedResume = NonNullable<ApprovedVacancyLetterResult['resume']>;

async function targetedPreview(versionId: string, signal?: AbortSignal) {
  const { version } = await getResumeVersion(versionId, signal);
  return {
    kind: 'targeted',
    title: 'Резюме под вакансию',
    text: formatTargetedResumeAsAtsText(version.snapshot),
  } satisfies LetterResumePreview;
}

async function masterPreview(): Promise<LetterResumePreview> {
  const studio = await getResumeStudio();
  return {
    kind: 'master',
    title: 'Резюме',
    text: formatResumeAsAtsText(studio.projection.master, studio.draft ?? EMPTY_RESUME_DRAFT),
  };
}

const GENERAL: LetterResumePreview = { kind: 'general', title: 'Ваше общее резюме', text: '' };
const NONE: LetterResumePreview = { kind: 'none', title: 'Резюме', text: '' };

/**
 * After approval the attached resume is read as it is; before approval the letter prepares the
 * targeted version it will attach (one per vacancy and master revision, so nothing duplicates).
 */
export async function loadLetterResumePreview(
  vacancyId: string,
  approved: ApprovedResume | null,
  signal?: AbortSignal,
): Promise<LetterResumePreview> {
  if (approved) {
    if (approved.kind === 'general') return GENERAL;
    return approved.versionId ? targetedPreview(approved.versionId, signal) : masterPreview();
  }
  const prepared = await prepareVacancyLetterResume(vacancyId);
  if (!prepared.ready) return NONE;
  return prepared.versionId ? targetedPreview(prepared.versionId, signal) : masterPreview();
}
