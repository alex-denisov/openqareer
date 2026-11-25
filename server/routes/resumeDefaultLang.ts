import type { ResumeEditChoices, ResumeLang } from '../../shared/resumeVacancyEdits';
import { documentLang, isTranslated, translateDocument } from '../domain/resumeTranslation';
import { tailorResumeSlice } from '../domain/resumeVacancyEdits';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { detectVacancyLanguage } from '../domain/vacancyPitchService';
import { hasAttachableResume, letterResumeKind, targetedSliceFor } from './letterApprovalResume';
import type { ResumeEditDeps } from './resumeEditRoutes';
import { currentMaster } from './resumeMaster';

/** Первый перевод всего резюме: десятки строк параллельно. */
export const TRANSLATION_BUDGET_MS = 40_000;

type Slice = ReturnType<typeof targetedSliceFor>;

export function vacancyLang(cluster: VacancyCluster): ResumeLang {
  return detectVacancyLanguage({
    id: cluster.id,
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany,
    description: cluster.descriptionSummary,
  });
}

/** Пока кандидат не выбрал язык сам, резюме — на языке вакансии. */
export function withVacancyLang(
  choices: ResumeEditChoices,
  slice: Slice,
  cluster: VacancyCluster,
): ResumeEditChoices {
  if (choices.lang) return choices;
  const lang = vacancyLang(cluster);
  return lang === documentLang(slice.document) ? choices : { ...choices, lang };
}

/**
 * Решения для сборки резюме; резюме заранее переведено на язык вакансии. Перевод не собрался —
 * резюме остаётся на языке профиля, а готовые строки хранятся до следующего открытия.
 */
export async function prepareVacancyLang(
  deps: ResumeEditDeps,
  candidateId: string,
  cluster: VacancyCluster,
): Promise<ResumeEditChoices> {
  const stored = deps.resumeEdits.read(candidateId, cluster.id);
  const master = currentMaster(deps, candidateId);
  if (stored.lang || letterResumeKind(deps, candidateId) === 'master') return stored;
  if (!hasAttachableResume(master.document)) return stored;
  const slice = targetedSliceFor(master, cluster);
  const { lang } = withVacancyLang(stored, slice, cluster);
  if (!lang) return stored;
  const { document } = tailorResumeSlice(slice, stored);
  const known = stored.translations ?? {};
  if (isTranslated(document, lang, known)) return { ...stored, lang };
  const { translations } = await translateDocument(
    document,
    lang,
    known,
    deps.experienceFactRewriter,
    TRANSLATION_BUDGET_MS,
  );
  const latest = deps.resumeEdits.read(candidateId, cluster.id);
  const next = { ...latest, translations: { ...latest.translations, ...translations } };
  if (Object.keys(translations).length > Object.keys(known).length) {
    deps.resumeEdits.save(candidateId, cluster.id, next, new Date().toISOString());
  }
  return withVacancyLang(next, slice, cluster);
}
