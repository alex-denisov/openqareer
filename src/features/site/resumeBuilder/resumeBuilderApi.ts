import { apiFetch, readData } from '../../coach/apiClient';
import { importCandidateResume } from '../../resume/resumeApi';
import { builderResumeText } from '../../../../shared/resumeBuilder/text';
import type { BuilderResume, ResumeTemplate } from '../../../../shared/resumeBuilder/model';
import type { ExportFormat } from './resumeBuilderStorage';

export type KeywordsOutcome = 'text' | 'pool' | 'unsupported_link' | 'not_in_pool' | 'no_keywords';

export interface VacancyKeywords {
  readonly outcome: KeywordsOutcome;
  readonly keywords: readonly string[];
  readonly vacancy?: { readonly title: string; readonly company: string };
}

/** A link is looked up in the openqareer pool; pasted text is read as is. */
export async function fetchVacancyKeywords(input: string): Promise<VacancyKeywords> {
  const value = input.trim();
  const body = /^https?:\/\/\S+$/iu.test(value) ? { link: value } : { text: value };
  const response = await apiFetch('/api/v1/resume-builder/keywords', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readData<VacancyKeywords>(response);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? 'Не удалось собрать файл. Попробуйте ещё раз.';
  } catch {
    return 'Не удалось собрать файл. Попробуйте ещё раз.';
  }
}

/** Downloads the real file the server built; signed-in only. */
export async function downloadResumeFile(
  resume: BuilderResume,
  template: ResumeTemplate,
  format: ExportFormat,
): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/resume-builder/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, template, resume }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${resume.fullName.trim() || 'resume'}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** The builder's document enters the profile with the source «конструктор резюме». */
export async function saveBuilderResumeToProfile(resume: BuilderResume): Promise<void> {
  await importCandidateResume({ text: builderResumeText(resume), source: 'builder' });
}
