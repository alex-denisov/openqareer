import { vacancySourceText, type VacancyRequirement } from './vacancyRequirements';

/**
 * A duty says what the job will ask, a requirement what the candidate must already have (04.11):
 * «Carry out on-ground client visits» lowered the percent like a missing skill. Read from where the
 * line stands in the text, so no extraction or model call is repeated and no cached result expires.
 */
const DUTY_HEADING =
  /^(?:(?:key |main |core |your |job |the )*(?:responsibilit\S*|duties|accountabilit\S*|tasks)|what (?:you(?:(?:'|’)ll| will)|you) (?:do|be doing|own|drive|achieve|work on)|what you(?:(?:'|’)ll| will) (?:do|own)|in this role|your (?:role|impact|mission|first priorities)|the mandate|how you(?:(?:'|’)ll| will) (?:contribute|operate)|in your first (?:year|\d+ days).*you(?:(?:'|’)ll| will)|as (?:our|a|an|the) .{0,50}you(?:(?:'|’)ll| will)|обязанности|(?:основные |ключевые |ваши |главные )*задачи|чем (?:предстоит|нужно|будете) занимат\S*|что (?:предстоит|нужно) делать|что (?:вы будете|будете) делать|функционал|зона ответственности|vos missions)(?!\p{L})/iu;
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
    const heading = headingOf(line) ?? (bulleted && isShortPlainLine(line) ? 'other' : null);
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
