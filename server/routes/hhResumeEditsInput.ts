import { createHash } from 'node:crypto';
import type { HhResumeContent, HhResumeEdit, HhResumeSections, HhResumeSnapshot } from '../../shared/hhCandidateSession';
import type { HhEditsInput, HhPlatformPlace } from '../domain/hhResumeEdits';
import { buildTargetedResumeSlice } from '../domain/resumeStudio';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import type { RouteDeps } from './deps';
import { currentMaster } from './resumeMaster';

/**
 * B678: из чего платформа предлагает правки резюме hh.ru: мастер-резюме кандидата с его
 * подтверждёнными пунктами в порядке пользы для вакансии и настоящие названия компаний (B639).
 */
export type SelectedWithSections = HhResumeContent & { readonly sections: HhResumeSections };

/** Прочитанные резюме списка с разделами; у выбранного разделы могли прийти вместе со сверкой. */
export function readWithSections(snapshot: HhResumeSnapshot): SelectedWithSections[] {
  const all = [...(snapshot.selected ? [snapshot.selected] : []), ...(snapshot.contents ?? [])];
  const withSections = all.flatMap((content) => (content.sections ? [{ ...content, sections: content.sections }] : []));
  return withSections.filter((content, index) => withSections.findIndex((item) => item.id === content.id) === index);
}

export function selectedWithSections(snapshot: HhResumeSnapshot | null): SelectedWithSections | null {
  const selected = snapshot?.selected;
  if (!selected) return null;
  return readWithSections(snapshot).find((content) => content.id === selected.id) ?? null;
}

function platformPlaces(deps: RouteDeps, candidateId: string, cluster: VacancyCluster) {
  const master = currentMaster(deps, candidateId);
  const targeted = buildTargetedResumeSlice(master.document, {
    title: cluster.canonicalTitle,
    requirements: cluster.skills,
  }).document;
  const realNames = new Map(master.draft.experience.map((place) => [place.id, place.employerRealName?.trim()]));
  const places: HhPlatformPlace[] = targeted.experience.map((place) => {
    const realName = realNames.get(place.id);
    return {
      id: place.id,
      employer: place.employer?.value.trim() ?? '',
      aliases: realName ? [realName] : [],
      bullets: [place.description?.value, ...place.bullets.map((bullet) => bullet.value)].flatMap((text) =>
        text?.trim() ? [text.trim()] : [],
      ),
    };
  });
  const facts = [
    master.document.about ?? '',
    ...places.flatMap((place) => place.bullets),
    ...(master.document.skills ?? []).map((skill) => skill.name),
  ].filter(Boolean);
  return { about: master.document.about?.trim() || null, places, facts };
}

export function hhEditsInput(
  deps: RouteDeps,
  candidateId: string,
  snapshot: HhResumeSnapshot,
  selected: SelectedWithSections,
  cluster: VacancyCluster,
): HhEditsInput {
  return {
    resume: { id: selected.id, title: selected.title, sections: selected.sections },
    otherTitles: snapshot.resumes.filter((item) => item.id !== selected.id).map((item) => item.title),
    vacancy: { title: cluster.canonicalTitle, requirements: cluster.skills },
    platform: platformPlaces(deps, candidateId, cluster),
  };
}

/**
 * B678: разбор одного резюме под одну вакансию держится 10 минут: повторное открытие шага отправки
 * не переводит те же строки снова. Ключ — само содержимое: изменилось резюме — новый разбор, а выбор из листа его не сбрасывает.
 */
const EDITS_CACHE_TTL_MS = 10 * 60_000;
const EDITS_CACHE_LIMIT = 200;
const editsCache = new Map<string, { readonly at: number; readonly edits: readonly HhResumeEdit[] }>();

export function editsCacheKey(candidateId: string, snapshot: HhResumeSnapshot, resume: SelectedWithSections, vacancyId: string): string {
  const content = createHash('sha256')
    .update(JSON.stringify([resume.title, resume.sections, snapshot.resumes.map((item) => item.title)]))
    .digest('hex');
  return [candidateId, resume.id, content, vacancyId].join('\u0000');
}

export function cachedEdits(key: string, now = Date.now()): readonly HhResumeEdit[] | null {
  const hit = editsCache.get(key);
  if (!hit) return null;
  if (now - hit.at > EDITS_CACHE_TTL_MS) {
    editsCache.delete(key);
    return null;
  }
  return hit.edits;
}

export function rememberEdits(key: string, edits: readonly HhResumeEdit[], now = Date.now()): void {
  editsCache.delete(key);
  editsCache.set(key, { at: now, edits });
  const oldest = editsCache.keys().next().value;
  if (editsCache.size > EDITS_CACHE_LIMIT && oldest !== undefined) editsCache.delete(oldest);
}
