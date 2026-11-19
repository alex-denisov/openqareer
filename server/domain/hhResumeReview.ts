import type {
  HhResumeContent,
  HhResumeFit,
  HhResumeReview,
  HhResumeSnapshot,
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
  return contents;
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

function recommended(fits: readonly HhResumeFit[], selectedId: string | undefined): string | null {
  const read = fits.filter((fit) => fit.status !== 'unread');
  if (read.length === 0) return null;
  const best = Math.max(...read.map((fit) => fit.matched.length));
  const top = read.filter((fit) => fit.matched.length === best);
  return (top.find((fit) => fit.resumeId === selectedId) ?? top[0]!).resumeId;
}

export function reviewHhResumes(
  snapshot: HhResumeSnapshot,
  rawRequirements: readonly string[],
): HhResumeReview {
  const requirements = uniqueRequirements(rawRequirements);
  const contents = readContents(snapshot);
  const resumes = snapshot.resumes.map((summary) => fitOf(summary, contents.get(summary.id), requirements));
  return { requirements, resumes, recommendedId: recommended(resumes, snapshot.selected?.id) };
}
