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
type SelectedWithSections = HhResumeContent & { readonly sections: HhResumeSections };

export function selectedWithSections(snapshot: HhResumeSnapshot | null): SelectedWithSections | null {
  const selected = snapshot?.selected;
  return selected?.sections ? { ...selected, sections: selected.sections } : null;
}

/**
 * Резюме с прочитанными разделами: выбранное или любое прочитанное для сверки (лист a01b
 * показывает «N правок» у каждого). Без `resumeId` — выбранное.
 */
export function resumeWithSections(snapshot: HhResumeSnapshot | null, resumeId?: string): SelectedWithSections | null {
  const id = resumeId ?? snapshot?.selected?.id;
  const selected = selectedWithSections(snapshot);
  if (selected && selected.id === id) return selected;
  const content = snapshot?.contents?.find((item) => item.id === id);
  return content?.sections ? { ...content, sections: content.sections } : null;
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
 * не переводит те же строки снова. Новое чтение резюме (readAt) — новый ключ.
 */
const EDITS_CACHE_TTL_MS = 10 * 60_000;
const EDITS_CACHE_LIMIT = 200;
const editsCache = new Map<string, { readonly at: number; readonly edits: readonly HhResumeEdit[] }>();

export function editsCacheKey(candidateId: string, snapshot: HhResumeSnapshot, resumeId: string, vacancyId: string): string {
  return [candidateId, resumeId, snapshot.readAt, vacancyId].join('\u0000');
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
