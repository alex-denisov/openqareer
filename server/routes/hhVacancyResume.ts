import {
  hhSectionsRead,
  type HhResumeContent,
  type HhResumeCopy,
  type HhResumeSnapshot,
} from '../../shared/hhCandidateSession';
import { reviewHhResumes, type HhTitleRank } from '../domain/hhResumeReview';
import { candidateRoleFunctionCodes } from '../vacancies/titleParse/candidateRoleFunctions';
import { resolvePoolVacancyCluster } from '../vacancies/poolVacancyCluster';
import { evaluateTitleRole } from '../vacancies/vacancyMatcher';
import type { RouteDeps } from './deps';

/**
 * Резюме hh.ru для вакансии: выбранное кандидатом под неё, а пока не выбрал — подходящее по роли.
 * Общий выбор из «Профиля» остаётся запасным, когда сравнить не с чем.
 */
const CHOICES_MAX = 500;
const ROLE_RANK = { none: 0, partial: 1, target: 2 } as const;

const words = (title: string): ReadonlySet<string> =>
  new Set(title.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

export function titleRank(vacancyTitle: string): (resumeTitle: string) => HhTitleRank {
  const wanted = words(vacancyTitle);
  return (resumeTitle) => ({
    role: ROLE_RANK[
      evaluateTitleRole(vacancyTitle, [resumeTitle], candidateRoleFunctionCodes([resumeTitle]))
    ],
    words: [...words(resumeTitle)].filter((word) => wanted.has(word)).length,
  });
}

/** Прочитанное заново заменяет прежнее, остальное остаётся, пока резюме в списке. */
export function mergedContents(
  previous: HhResumeSnapshot | null,
  listed: ReadonlySet<string>,
  read: readonly HhResumeContent[],
): Pick<HhResumeSnapshot, 'contents'> {
  const before = (previous?.contents ?? []).filter((content) => listed.has(content.id));
  const good = new Set(
    before.filter((content) => hhSectionsRead(content.sections)).map((content) => content.id),
  );
  // Чтение без опыта не прочитанное прежде не портит.
  const usable = read.filter(
    (content) => hhSectionsRead(content.sections) || !good.has(content.id),
  );
  const fresh = new Set(usable.map((content) => content.id));
  const contents = [...usable, ...before.filter((content) => !fresh.has(content.id))];
  return contents.length > 0 ? { contents } : {};
}

export function chooseHhResume(
  snapshot: HhResumeSnapshot,
  vacancyId: string,
  resumeId: string,
): HhResumeSnapshot {
  const { [vacancyId]: _previous, ...others } = snapshot.choices ?? {};
  const kept = Object.entries(others).slice(-(CHOICES_MAX - 1));
  return { ...snapshot, choices: { ...Object.fromEntries(kept), [vacancyId]: resumeId } };
}

/** B787: копию под другую вакансию к этой не предлагаем. */
export function withoutOtherCopies(snapshot: HhResumeSnapshot, vacancyId: string): HhResumeSnapshot {
  const others = new Set(
    Object.entries(snapshot.copies ?? {}).flatMap(([id, copy]) => (id !== vacancyId && copy.copyId ? [copy.copyId] : [])),
  );
  return others.size > 0 ? { ...snapshot, resumes: snapshot.resumes.filter((item) => !others.has(item.id)) } : snapshot;
}

export function saveHhCopy(snapshot: HhResumeSnapshot, vacancyId: string, copy: HhResumeCopy | null): HhResumeSnapshot {
  const { [vacancyId]: _previous, ...others } = snapshot.copies ?? {};
  const kept = Object.fromEntries(Object.entries(others).slice(-(CHOICES_MAX - 1)));
  return { ...snapshot, copies: copy ? { ...kept, [vacancyId]: copy } : kept };
}

function contentOf(snapshot: HhResumeSnapshot, resumeId: string): HhResumeContent | null {
  const found = [
    ...(snapshot.selected ? [snapshot.selected] : []),
    ...(snapshot.contents ?? []),
  ].filter((content) => content.id === resumeId);
  const content = found.find((item) => hhSectionsRead(item.sections)) ?? found[0];
  const title = snapshot.resumes.find((item) => item.id === resumeId)?.title;
  // Ещё не читали: известны только номер и заголовок.
  return content ?? (title ? { id: resumeId, title, text: '' } : null);
}

/** Снимок, где `selected` — резюме этой вакансии. */
export function resumesForVacancy(
  deps: Pick<RouteDeps, 'multiSourceEngine'>,
  snapshot: HhResumeSnapshot,
  vacancyId: string,
): HhResumeSnapshot {
  const chosen = snapshot.choices?.[vacancyId];
  const listed = chosen && snapshot.resumes.some((item) => item.id === chosen) ? chosen : null;
  const cluster = listed ? undefined : resolvePoolVacancyCluster(deps.multiSourceEngine, vacancyId);
  const fitting = cluster
    ? reviewHhResumes(withoutOtherCopies(snapshot, vacancyId), cluster.skills, titleRank(cluster.canonicalTitle)).recommendedId
    : null;
  const id = listed ?? fitting ?? snapshot.selected?.id;
  return { ...snapshot, selected: id ? contentOf(snapshot, id) : null };
}
