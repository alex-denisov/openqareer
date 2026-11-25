import { vacancySourceText, type VacancyRequirement } from './vacancyRequirements';

/**
 * A duty says what the job will ask, a requirement what the candidate must already have (04.11):
 * «Carry out on-ground client visits» lowered the percent like a missing skill. Read from where the
 * line stands in the text, so no extraction or model call is repeated and no cached result expires.
 */
const DUTY_HEADING =
  /^(?:(?:key |main |core |your |job |the |primary |essential |major )*(?:responsibilit\S*|duties|accountabilit\S*|functions|tasks)|what (?:you(?:(?:'|’)ll| will)|you) (?:do|be doing|own|drive|lead|achieve|work on)|what you(?:(?:'|’)ll| will) (?:do|own)|what impact you(?:(?:'|’)ll| will) make|in this role|your (?:role|impact|mission|first priorities)|the mandate|how you(?:(?:'|’)ll| will) (?:contribute|operate)|in your first (?:year|\d+ days).*you(?:(?:'|’)ll| will)|as (?:our|a|an|the) .{0,50}you(?:(?:'|’)ll| will)|(?:основные |ключевые |ваши |главные |наши |должностные )*(?:обязанности|задачи|цели)|какие задачи|(?:вам |тебе )?предстоит|чем (?:ты |вы )?(?:предстоит|нужно|будете|будешь) занимат\S*|что (?:вам |тебе )?(?:предстоит|нужно делать)|что (?:вы будете|будете) делать|функционал|зона ответственности|vos missions)(?!\p{L})/iu;
const REQUIREMENT_HEADING =
  /^(?:requirements?|(?:(?:basic|preferred|minimum|required|key|desired)\s+)*(?:qualifications?|skills)|what (?:you(?:(?:'|’)ll| will)? (?:need|bring)|(?:are )?we(?:(?:'|’)re| are)? (?:expect|look)\S*|you have|makes you)|who (?:you are|we(?:(?:'|’)re| are) looking for)|about you|skills and experience|experience|your (?:skills|profile|background|experience)|you have|требования|мы ожидаем|что (?:нужно|мы ожидаем|ожидаем)|(?:что )?(?:мы )?жд[её]м|нам важно|вы нам подходите|от вас|нам нужен|опыт и навыки|votre profil|profil recherch\S*)(?!\p{L})/iu;
/** Sections after which a line is neither: an offer never turns the next list into duties. */
const OTHER_HEADING =
  /^(?:benefits|what we offer|perks|about (?:us|the company)|why |compensation|условия|мы предлагаем|что (?:мы )?предлагаем|о компании|почему )/iu;
/** What the candidate has, whatever list it landed in: a heading glued to a bullet misplaces lines. */
const STATES_A_QUALITY =
  /^(?:\d+\s*\+?|опыт|глубок|экспертиз|знани|понимани|высшее|experience|proven|strong|deep|extensive|excellent|ability|knowledge|familiarity|proficien)/iu;
const MAX_HEADING_CHARS = 70;
const BULLET = /^\s*(?:[-–—*•▪·]+|\d+[.)])\s*/u;

type Section = 'duty' | 'requirement' | 'other';

function headingOf(line: string): Section | null {
  const text = line.replace(BULLET, '').trim();
  if (BULLET.test(line) || !text || text.length > MAX_HEADING_CHARS) return null;
  if (DUTY_HEADING.test(text)) return 'duty';
  if (REQUIREMENT_HEADING.test(text)) return 'requirement';
  // An unnamed heading («Why it matters:») closes the section: a wrong duty inflates the percent.
  return OTHER_HEADING.test(text) || /[:：?]$/u.test(text) ? 'other' : null;
}

/**
 * B794: «Team Leadership», «Управление персоналом» внутри обязанностей — их подраздел, а не новый
 * раздел. Раздел качеств называет себя сам («Skills», «Опыт») и под это правило не попадает.
 */
const DUTY_TOPIC =
  /^(?!.*(?<!\p{L})(?:skills?|experience|expertise|qualif\S*|competenc\S*|required|preferred|must|requirements?|навык\S*|опыт\S*|знани\S*|требовани\S*|условия)(?!\p{L})).*(?:(?<!\p{L})(?:leadership|management|operations?|collaboration|excellence|governance|strategy|planning|reporting|partnership|delivery|engagement|execution|oversight)|^(?:управление|развитие команды|операционн\p{L}* (?:управление|эффективность)|финансов\p{L}* (?:управление|контроль)).*)[:：]?$/iu;
/** Заголовок, приклеенный к последнему пункту: «- Отчётность Требования:». */
const GLUED_REQUIREMENTS = /(?<!\p{L})(?<!(?:salary|visa|travel|physical|work|system|pay|legal|business|compliance|security|project|product|client|customer|technical|regulatory)\s)(?:требования|requirements|qualifications)\s*[:：]$/iu;

const isShortPlainLine = (line: string) => {
  const text = line.trim();
  return Boolean(text) && !BULLET.test(line) && text.length <= MAX_HEADING_CHARS && !/[.;,]$/u.test(text);
};

/**
 * The section each line of the text falls under; `null` before the first heading. A plain short
 * line after a bulleted list is a heading this file does not know («Required skills»): it closes
 * the list, since a wrong duty inflates the percent and a missed one only leaves it as it was.
 */
function sectionsOf(description: string): readonly { readonly line: string; readonly section: Section | null }[] {
  let section: Section | null = null;
  let bulleted = false;
  return vacancySourceText(description).split('\n').map((line) => {
    const named = GLUED_REQUIREMENTS.test(line.trim())
      ? 'requirement'
      : (headingOf(line) ?? (bulleted && isShortPlainLine(line) ? 'other' : null));
    // A bare «Leadership:» may as well open the list of qualities, so one word never continues duties.
    const isTopic = named === 'other' && section === 'duty' && /\S\s+\S/u.test(line.trim()) && DUTY_TOPIC.test(line.trim());
    const heading = isTopic ? 'duty' : named;
    if (heading) {
      section = heading;
      bulleted = false;
    } else if (BULLET.test(line)) bulleted = true;
    return { line, section };
  });
}

/** Ids of the skill-side lines that are duties of the vacancy; conditions are never duties. */
export function vacancyDutyIds(description: string, requirements: readonly VacancyRequirement[]): ReadonlySet<string> {
  const lines = sectionsOf(description);
  return new Set(requirements.filter((requirement) => {
    if (requirement.kind !== 'experience' && !(requirement.skill ?? requirement.kind === 'other')) return false;
    const quote = requirement.sourceQuote.trim();
    if (STATES_A_QUALITY.test(quote)) return false;
    return lines.find(({ line }) => line.includes(quote))?.section === 'duty';
  }).map((requirement) => requirement.id));
}
