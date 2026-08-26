import type {
  ParsedResume,
  ParsedResumeLanguage,
} from '../../features/workspace/resumeParser';
import type { CefrLevel } from '../../features/resume/resumeTypes';
import { extractTagContent, plainText } from './hhMarkup';

/**
 * What hh.ru states about the person on `/applicant/profile/me`.
 *
 * The resume page is not the whole account. On hh.ru's current surface the
 * candidate's **name is not rendered on the resume page at all** — the profile
 * page is the only place it exists — and so are the city, the languages and
 * hh.ru's own statement that the work history is empty. Reading only the
 * resume page left the cabinet greeting the candidate by their openqareer
 * login and Resume Studio holding nothing (owner report, 2026-08-26; B172).
 */
export interface HhProfileIdentity {
  readonly fullName?: string;
  readonly location?: string;
  readonly languages: readonly ParsedResumeLanguage[];
  /** hh.ru rendered its own «no experience yet» card for this account. */
  readonly experienceDeclaredEmpty: boolean;
}

const EMPTY_IDENTITY: HhProfileIdentity = {
  languages: [],
  experienceDeclaredEmpty: false,
};

export function parseHhProfilePage(html: string): HhProfileIdentity {
  if (!html) return EMPTY_IDENTITY;
  return {
    fullName: profileName(html),
    location: labelledCellValue(html, 'Где живёте'),
    languages: profileLanguages(html),
    experienceDeclaredEmpty: /data-qa=["']profile-experience-card-empty["']/iu.test(html),
  };
}

/**
 * Fills what the resume page left empty, and nothing else.
 *
 * The resume is the document the candidate maintains; the profile page is
 * context around it. Where both speak, the resume wins — overwriting a stated
 * value with a page-level one would silently change the candidate's own words.
 * `rawText` is rebuilt because it is the entire message the candidate API
 * receives: a name missing from it is a name the profile never gets.
 */
export function withHhProfileIdentity(
  resume: ParsedResume,
  identity: HhProfileIdentity,
): ParsedResume {
  const fullName = resume.fullName ?? identity.fullName;
  const location = resume.contact.location ?? identity.location;
  const languages =
    resume.languages.length > 0 ? resume.languages : [...identity.languages];
  const added = [
    resume.fullName ? '' : (identity.fullName ?? ''),
    resume.contact.location ? '' : (identity.location ?? ''),
    resume.languages.length > 0 || languages.length === 0
      ? ''
      : `Языки: ${languages.map(languageLine).join(', ')}`,
  ].filter(Boolean);
  return {
    ...resume,
    fullName,
    contact: { ...resume.contact, location },
    languages,
    rawText: added.length > 0 ? `${added.join('\n\n')}\n\n${resume.rawText}` : resume.rawText,
  };
}

function languageLine(language: ParsedResumeLanguage): string {
  return [language.name, language.cefr].filter(Boolean).join(' ');
}

/**
 * The profile heading. hh.ru marks it as the page's `h1` with `data-qa="title"`
 * — section headings on the same page are `h4`, so the tag is what separates
 * the person from «Контакты» and «Навыки».
 */
function profileName(html: string): string | undefined {
  const name = extractTagContent(
    html,
    /<h1[^>]*data-qa=["']title["'][^>]*>([\s\S]*?)<\/h1>/iu,
  );
  return name ?? undefined;
}

/**
 * hh.ru renders these facts as label/value pairs of `cell-text-content`: the
 * label «Где живёте» and then the answer. Reading the label as the answer is
 * exactly the not-quite-true display the design contract forbids.
 */
function labelledCellValue(html: string, label: string): string | undefined {
  const cells = cellTexts(html);
  const index = cells.indexOf(label);
  const value = index >= 0 ? cells[index + 1] : undefined;
  if (!value || value.startsWith('Не указано')) return undefined;
  // «Казань · Метро не указано» — the city is the part before the separator.
  return value.split('·')[0].trim() || undefined;
}

/**
 * Every labelled cell in document order, repeats included.
 *
 * Position is the only thing that ties a value to its label here, so this must
 * not collapse duplicates the way the shared reader does: two cells that both
 * read «Не указано» would shift every following pair by one and put a label
 * where a city belongs.
 */
function cellTexts(html: string): readonly string[] {
  const regex = /data-qa=["']cell-text-content["'][^>]*>([\s\S]*?)<\/(?:div|span)>/giu;
  const texts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    texts.push(plainText(match[1] ?? ''));
  }
  return texts;
}

/**
 * One row per language: the name, then the level hh.ru states for it.
 *
 * Only those two cells are read. Scanning the whole row region for a level
 * pattern picked one out of unrelated page text further down and printed
 * «Русский C2» over a row that said «Родной» — a claim the source never made.
 */
function profileLanguages(html: string): readonly ParsedResumeLanguage[] {
  const card = /data-qa=["']profile-language-card["']([\s\S]*?)(?=<h4|$)/iu.exec(html);
  if (!card) return [];
  const rows = card[1].split(/data-qa=["']profile-language-card-row-\d+["']/iu).slice(1);
  return rows
    .map((row): ParsedResumeLanguage | undefined => {
      const cells = cellTexts(row);
      const name = cells[0];
      if (!name) return undefined;
      const cefr = cefrOf(cells[1] ?? '');
      return cefr ? { name, cefr } : { name };
    })
    .filter((language): language is ParsedResumeLanguage => language !== undefined);
}

const CEFR_LEVELS: readonly CefrLevel[] = ['C2', 'C1', 'B2', 'B1', 'A2', 'A1'];

function cefrOf(text: string): CefrLevel | undefined {
  const upper = text.toUpperCase();
  return CEFR_LEVELS.find((level) => upper.includes(level));
}
