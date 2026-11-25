import type { ResumeCertificationInput } from './resumeDraft';
import { relevanceScore, type ResumeRelevance } from './resumeRelevance';

/** Сертификатов в резюме под вакансию; без подходящих — только самые весомые (B785). */
const MAX_SHOWN = 4;
const MAX_UNRELATED = 2;

const PROFESSIONAL =
  /(?<!\p{L})(?:itil|pmi|pmp|prince2|togaf|cobit|cissp|cism|cisa|ccnp|ccie|ccna|aws|azure|google cloud|oracle|red hat|cka|six sigma|iso|safe|psm|csm|cfa|acca|cima|mba)(?!\p{L})|peoplecert|axelos|project management institute|isaca|scrum/iu;
const COURSE =
  /coursera|udemy|stepik|skillbox|edx|linkedin learning|нетолог|geekbrains|яндекс.?практикум|school|школ|(?<!\p{L})(?:course|webinar|workshop|bootcamp)(?!\p{L})|курс|вебинар|олимпиад/iu;

/** Начала русских названий месяцев: «окт 2026», «октября 2026», «мая 2026». */
const RU_MONTHS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'ма[йя]',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const;

/** Конец месяца (или года, если месяц неизвестен); непонятная дата — `null`. */
function endOf(value: string | undefined): number | null {
  const text = value?.trim() ?? '';
  const year = /(?:19|20)\d{2}/u.exec(text)?.[0];
  if (!year) return null;
  const iso = /(?:19|20)\d{2}-(\d{2})/u.exec(text)?.[1];
  const short = /(?<!\d)(\d{1,2})[./](?:19|20)\d{2}/u.exec(text)?.[1];
  const russian =
    RU_MONTHS.findIndex((stem) => new RegExp(`(?<!\\p{L})${stem}`, 'iu').test(text)) + 1;
  const named = Date.parse(
    text.replace(/^\D*?(\p{L}{3})\p{L}*\.?\s+((?:19|20)\d{2}).*$/u, '1 $1 $2'),
  );
  const month = Number(iso ?? short ?? russian);
  if (month >= 1 && month <= 12) return Date.UTC(Number(year), month, 1);
  if (/\p{L}/u.test(text) && Number.isFinite(named)) {
    return Date.UTC(Number(year), new Date(named).getMonth() + 1, 1);
  }
  return Date.UTC(Number(year) + 1, 0, 1);
}

const keyOf = ({ name }: ResumeCertificationInput): string =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();

const textOf = ({ name, issuer }: ResumeCertificationInput): string => `${name} ${issuer ?? ''}`;

const issued = (item: ResumeCertificationInput): number => endOf(item.issuedAt) ?? 0;

/** Действующие без повторов: подходящие вакансии, за ними свежие; подходящих нет — весомые. */
export function shownCertifications(
  all: readonly ResumeCertificationInput[],
  relevance: ResumeRelevance,
  now: Date,
): readonly ResumeCertificationInput[] {
  const seen = new Set<string>();
  const valid = [...all.filter((item) => (endOf(item.expiresAt) ?? Infinity) > now.getTime())]
    .sort((left, right) => issued(right) - issued(left))
    .filter((item) => {
      const key = keyOf(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({
      item,
      score: relevanceScore(relevance, item.name, item.evidenceMemoryId),
      known: PROFESSIONAL.test(textOf(item)),
    }));
  const isSerious = ({ item, score }: { item: ResumeCertificationInput; score: number }) =>
    score > 0 || !COURSE.test(textOf(item));
  // Сортировка устойчива: при равенстве остаётся порядок по свежести.
  const ranked = [...valid.filter(isSerious)].sort(
    (left, right) => right.score - left.score || Number(right.known) - Number(left.known),
  );
  const limit = ranked.some(({ score }) => score > 0) ? MAX_SHOWN : MAX_UNRELATED;
  return ranked.slice(0, limit).map(({ item }) => item);
}
