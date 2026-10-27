import { extractSkillsFromText } from '../connectors/telegramChannelParser';
import { extractVacancyRequirements } from '../domain/vacancyRequirements';

/**
 * B567: keywords of one vacancy for the builder's ATS check, read without a
 * model. Sources, in order: the skills the platform itself lists, the known
 * technology and management terms, and the terms written in the requirement
 * lines — abbreviations (РСБУ, НДС), product names (1С:ERP, Power BI).
 */
export const MAX_KEYWORDS = 25;

// Capitalised English words that open requirement sentences, not skills.
const ENGLISH_STOP = new Set(
  (
    'a an and or the of in on at to for with from by as is are be will you we our your ' +
    'experience knowledge ability strong good excellent proven understanding skills skill ' +
    'requirements required preferred must nice have has plus years year degree bachelor ' +
    "master working work team teams able other including such etc we're who what job role"
  ).split(' '),
);

const LATIN_TERM = /[A-Za-z][A-Za-z0-9+#]*(?:[.\-/][A-Za-z0-9+#]+)*(?: [A-Z][A-Za-z0-9+#]*)?/gu;
const CYRILLIC_ABBREVIATION =
  /(?<![\p{L}\d])\d?[А-ЯЁ]{2,6}(?:[:-][A-Za-zА-ЯЁа-яё0-9.]+)?(?![\p{L}])/gu;
const PRODUCT_WITH_DIGIT =
  /(?<![\p{L}\d])\d[A-Za-zА-ЯЁа-яё]{0,3}[:-][A-Za-zА-ЯЁа-яё][\wА-ЯЁа-яё.]*/gu;

function latinTerms(line: string): string[] {
  return [...line.matchAll(LATIN_TERM)]
    .map((match) => match[0].replace(/[.\-/]+$/u, ''))
    .filter((term) => {
      const words = term.toLowerCase().split(' ');
      if (words.every((word) => ENGLISH_STOP.has(word))) return false;
      // A lowercase English word is prose; a skill has a capital, a digit or a sign.
      return /[A-Z0-9+#]/u.test(term) && term.length >= 2 && !ENGLISH_STOP.has(words[0]);
    });
}

function cyrillicTerms(line: string): string[] {
  return [...line.matchAll(PRODUCT_WITH_DIGIT), ...line.matchAll(CYRILLIC_ABBREVIATION)].map(
    (match) => match[0],
  );
}

function pushUnique(target: string[], seen: Set<string>, values: Iterable<string>): void {
  for (const raw of values) {
    const value = raw.replace(/\s+/gu, ' ').trim();
    const key = value.toLowerCase().replace(/ё/gu, 'е');
    if (!value || value.length > 60 || seen.has(key)) continue;
    // «1С» inside «1С:ERP» is the same product; keep the more precise one.
    if ([...seen].some((known) => known.startsWith(`${key}:`) || known.endsWith(`:${key}`)))
      continue;
    seen.add(key);
    target.push(value);
  }
}

export function extractVacancyKeywords(
  text: string,
  listedSkills: readonly string[] = [],
): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();
  pushUnique(keywords, seen, listedSkills);
  const requirementLines = extractVacancyRequirements({
    vacancyId: 'resume-builder',
    description: text,
  }).requirements.map((item) => item.text);
  // Without a recognisable requirements section, the whole text is the source.
  const lines = requirementLines.length ? requirementLines : text.split(/\n+/u);
  for (const line of lines) pushUnique(keywords, seen, cyrillicTerms(line));
  pushUnique(keywords, seen, extractSkillsFromText(lines.join('\n')));
  for (const line of lines) pushUnique(keywords, seen, latinTerms(line));
  return keywords.slice(0, MAX_KEYWORDS);
}
