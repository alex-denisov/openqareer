import { MIN_FIT_SKILL_REQUIREMENTS } from '../../shared/vacancyFitPercent';
import { vacancySourceText, type VacancyRequirement } from './vacancyRequirements';

/**
 * A wish («будет плюсом», nice to have) never lowers the percent (owner 25.11). Read from the line
 * itself or the section it stands in, so no extraction or model call is repeated. «Опыт от 5 лет,
 * желательно в банке» keeps its mandatory half: the mark has to open or close the whole line.
 */
const LINE_OPENS =
  /^(?:желательн\p{L}*|(?:большим |дополнительным )?(?:плюсом|преимуществом) (?:будет|станет)|будет (?:большим |дополнительным )?(?:плюсом|преимуществом)|приветству[её]тся|nice[- ]to[- ]have|(?:it(?:['’]s| is) )?(?:a )?(?:big |strong |huge )?(?:plus|bonus)(?: points)?(?: if| for|\s*[:：])|preferabl[ey]|ideally|preferred\s*[:：]|good to have|desirable)(?!\p{L})/iu;
const LINE_CLOSES =
  /(?<!\p{L})(?:(?:—|-|–|\()?\s*(?:(?:как |это )?(?:большой |дополнительный )?плюс|(?:будет|станет|является) (?:большим |значительным |дополнительным |вашим |твоим )?(?:плюсом|преимуществом)|(?:плюсом|преимуществом) (?:будет|станет)|приветству[её]тся|желател(?:ьно|ен|ьна|ьны)|(?:(?:is|are|would be|will be|as|considered) (?:an? )?|an? )(?:(?:big|strong|huge|major|added|definite|distinct|significant) )?(?:plus|advantage|bonus)|(?:(?:is|are|highly|strongly|would be) )*(?:preferred|desirable|desired|advantageous|beneficial)|(?:is |are )?(?:a )?nice[- ]to[- ]have))[)\s.!;*]*$/iu;
/** What comes before the last comma is mandatory of its own: a term, a number, «required». */
const OWN_ASK =
  /\d|(?<!\p{L})(?:required|must|обязател\p{L}*|необходим\p{L}*|degree|bachelor\S*|высшее)(?!\p{L})/iu;

const SECTION_HEADING =
  /^(?:(?:что )?(?:также )?(?:будет|станет|является) (?:вашим |большим |дополнительным |значительным |для нас )?(?:плюсом|преимуществом)|(?:вашим |большим |дополнительным )?(?:плюсом|преимуществом)(?: (?:также |для вас |для нас )?(?:будет|станет|является))?|(?:желательно|желательные (?:навыки|требования)|дополнительными? (?:плюсом|преимуществом)|плюсы)|приветству[её]тся|(?:nice|good)[- ]to[- ]have(?:s|\s+(?:skills|qualifications|requirements|experience))?|bonus(?: points| skills)?(?: if you(?: have)?)?|(?:preferred|desired|desirable|additional preferred)(?: (?:skills|qualifications|experience|requirements|attributes|background|competencies|education|candidate profile)|\s*(?:and|&|\/)\s*\p{L}+)*|(?:it(?:['’]s| is) |what (?:would be|is) )?(?:a )?(?:big |huge )?plus(?:es)?(?: if| points)?|(?:would|will) be (?:a )?plus|even better if)(?: you(?: have|['’]ve)?)?(?:\s*\([^)]*\))?\s*[:：]?$/iu;
const GLUED_SECTION =
  /(?<!\p{L})(?:будет (?:большим |дополнительным )?плюсом|nice to have|preferred qualifications)\s*[:：]$/iu;
const INLINE_SECTION =
  /^(?:(?:также )?будет (?:большим |дополнительным )?(?:плюсом|преимуществом)|(?:большим |дополнительным )?(?:плюсом|преимуществом) (?:будет|станет)|желательно|nice[- ]to[- ]have|bonus points|preferred(?: (?:skills|qualifications|experience))?)\s*[:：]\s*\S/iu;
const REQUIRED_HEADING =
  /(?<!\p{L})(?:required|requirements|minimum|basic qualifications|требования|обязательн\p{L}*)(?!\p{L})/iu;
const BULLET = /^\s*(?:[-–—*•▪·]+|\d+[.)])\s*/u;
const MAX_HEADING_CHARS = 70;
const bare = (line: string) => line.replace(BULLET, '').replace(/\*\*/gu, '').trim();

function isWishText(text: string): boolean {
  const line = bare(text);
  if (LINE_OPENS.test(line)) return true;
  const closing = LINE_CLOSES.exec(line);
  if (!closing) return false;
  const before = line.slice(0, closing.index);
  // «Cloud (Azure; AWS a plus)»: the mark belongs to the bracket, not to the line.
  if (before.split('(').length > before.split(')').length) return false;
  // «10+ years in X. Certified is a plus», «English B2, German is a plus»: only the tail is a wish.
  if (/[.;]\s/u.test(before)) return false;
  return !OWN_ASK.test(before.slice(0, Math.max(before.lastIndexOf(','), 0)));
}

/** The lines of «Будет плюсом:» up to the next heading. */
function wishLines(description: string): ReadonlySet<string> {
  const wishes = new Set<string>();
  let open = false;
  let bulleted = false;
  // «-», then the text on a line of its own: how a list item reads after the tags are gone.
  let loneBullet = false;
  for (const raw of vacancySourceText(description).split('\n')) {
    const line = bare(raw);
    if (!line) {
      loneBullet = loneBullet || BULLET.test(raw + ' ');
      continue;
    }
    const isBullet = loneBullet || BULLET.test(raw);
    loneBullet = false;
    if (
      SECTION_HEADING.test(line) ||
      (line.length <= MAX_HEADING_CHARS * 3 && GLUED_SECTION.test(line))
    ) {
      open = true;
      bulleted = false;
      continue;
    }
    if (INLINE_SECTION.test(line)) {
      wishes.add(line);
      continue;
    }
    const shortPlain = !isBullet && line.length <= MAX_HEADING_CHARS && !/[.;,]$/u.test(line);
    // A short plain line after bullets, or any line with a colon, is the next heading.
    if (shortPlain && (bulleted || /[:：?]$/u.test(line))) open = false;
    if (shortPlain && REQUIRED_HEADING.test(line)) open = false;
    // A paragraph after bullets belongs to the next part of the text.
    if (!isBullet && bulleted) open = false;
    if (isBullet) bulleted = true;
    if (open) wishes.add(line);
  }
  return wishes;
}

/** Ids of the requirements the vacancy itself calls optional. */
export function vacancyWishIds(
  description: string,
  requirements: readonly VacancyRequirement[],
  counts: (requirement: VacancyRequirement) => boolean,
): ReadonlySet<string> {
  const lines = [...wishLines(description)];
  const text = vacancySourceText(description).split('\n').map(bare);
  const inWishSection = (quote: string) =>
    quote.length > 0 &&
    lines.some((line) => line.includes(quote)) &&
    // The same words outside the section make them an ordinary requirement.
    text.filter((line) => line.includes(quote)).every((line) => lines.includes(line));
  const ids = (own: (item: VacancyRequirement) => boolean) =>
    new Set(requirements.filter(own).map((item) => item.id));
  const byText = ids((item) => isWishText(item.text) || isWishText(item.sourceQuote));
  const all = ids((item) => byText.has(item.id) || inWishSection(bare(item.sourceQuote)));
  // «Что будет вашим преимуществом» over the only list of the text is its requirements.
  const left = requirements.filter((item) => counts(item) && !all.has(item.id)).length;
  return left >= MIN_FIT_SKILL_REQUIREMENTS ? all : byText;
}
