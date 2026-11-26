import {
  hhSectionsRead,
  type HhResumeContent,
  type HhResumeFit,
  type HhResumeReview,
  type HhResumeSnapshot,
} from '../../shared/hhCandidateSession';

/**
 * B678: какое из резюме hh.ru кандидата подходит вакансии. Требование ищется в заголовке и тексте
 * резюме целым словом без учёта регистра — так же, как сборка резюме под вакансию сверяет профиль.
 * Резюме, чьё содержимое не читали, сверке не подлежит и так и названо.
 */
function normalized(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function uniqueRequirements(requirements: readonly string[]): string[] {
  const seen = new Set<string>();
  return requirements.flatMap((raw) => {
    const label = raw.trim();
    const key = normalized(label);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [label];
  });
}

function readContents(snapshot: HhResumeSnapshot): Map<string, HhResumeContent> {
  const contents = new Map((snapshot.contents ?? []).map((content) => [content.id, content]));
  if (snapshot.selected) contents.set(snapshot.selected.id, snapshot.selected);
  // Без опыта страница не прочиталась: «не хватает» по такому тексту было бы неправдой.
  return new Map([...contents].filter(([, content]) => !content.sections || hhSectionsRead(content.sections)));
}

function fitOf(
  summary: { readonly id: string; readonly title: string },
  content: HhResumeContent | undefined,
  requirements: readonly string[],
): HhResumeFit {
  const base = { resumeId: summary.id, title: summary.title };
  if (!content) return { ...base, status: 'unread', matched: [], missing: [] };
  const text = ` ${normalized(`${content.title} ${content.text}`)} `;
  const matched = requirements.filter((requirement) => text.includes(` ${normalized(requirement)} `));
  const missing = requirements.filter((requirement) => !matched.includes(requirement));
  return { ...base, status: missing.length === 0 ? 'fits' : 'gaps', matched, missing };
}

/** Насколько заголовок резюме подходит вакансии: сначала родство ролей, затем общие слова. */
export interface HhTitleRank {
  readonly role: number;
  readonly words: number;
}

const NO_RANK = (): HhTitleRank => ({ role: 0, words: 0 });

/** Заголовок важнее совпавших требований: ими богато и резюме другой роли; прежний выбор — при равенстве. */
function recommended(
  fits: readonly HhResumeFit[],
  selectedId: string | undefined,
  rank: (title: string) => HhTitleRank,
): string | null {
  const scored = fits
    .map((fit) => ({ fit, title: rank(fit.title) }))
    .filter(({ fit, title }) => fit.status !== 'unread' || title.role > 0);
  const weights = ({ fit, title }: (typeof scored)[number]) => [
    title.role,
    fit.matched.length,
    title.words,
    fit.resumeId === selectedId ? 1 : 0,
  ];
  const better = (a: readonly number[], b: readonly number[]) => {
    const index = a.findIndex((value, position) => value !== b[position]);
    return index >= 0 && a[index]! > b[index]!;
  };
  const best = scored.reduce<(typeof scored)[number] | null>(
    (top, item) => (!top || better(weights(item), weights(top)) ? item : top),
    null,
  );
  return best?.fit.resumeId ?? null;
}

export function reviewHhResumes(
  snapshot: HhResumeSnapshot,
  rawRequirements: readonly string[],
  rank: (title: string) => HhTitleRank = NO_RANK,
): HhResumeReview {
  const requirements = uniqueRequirements(rawRequirements);
  const contents = readContents(snapshot);
  const resumes = snapshot.resumes.map((summary) => fitOf(summary, contents.get(summary.id), requirements));
  return { requirements, resumes, recommendedId: recommended(resumes, snapshot.selected?.id, rank) };
}
