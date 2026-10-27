import type {
  RelocationQuestionnaire,
  RelocationStepId,
} from '../../../shared/relocationQuestionnaire';
import type { ResumeDraft } from '../resume/resumeTypes';
import { worldCountryCode, worldCountryName } from './worldCountries';

/**
 * «Страны и релокация» reads what the profile already knows (diplomas,
 * certificates, languages, citizenship) instead of asking for it again, and
 * writes what the candidate adds here back into the profile, so the facts
 * live in one place.
 */

type Questionnaire = RelocationQuestionnaire;
type Education = Questionnaire['education']['education'][number];
type Certificate = Questionnaire['education']['certificates'][number];
type Language = Questionnaire['languages']['languages'][number];

const PROFILE_PREFIX = 'profile-';
const RELOCATION_PREFIX = 'reloc-';

export function isProfileFactRow(id: string): boolean {
  return id.startsWith(PROFILE_PREFIX);
}

function rowId(prefix: string, id: string): string {
  return `${prefix}${id.replace(/[^A-Za-z0-9_-]/gu, '-')}`.slice(0, 80);
}

/** A profile entry that relocation itself wrote back: `reloc-<relocation row id>`. */
function relocationOrigin(id: string): string | undefined {
  return id.startsWith(RELOCATION_PREFIX) ? id.slice(RELOCATION_PREFIX.length) : undefined;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** «Apr 2023», «2023-04», «2010» → ISO date; the end of a bare year is its last day. */
function profileDate(value: string | undefined, end: boolean): string | undefined {
  const text = value?.trim().toLowerCase() ?? '';
  const year = /(19|20)\d{2}/u.exec(text)?.[0];
  if (!year) return undefined;
  const iso = /^\d{4}-(\d{2})/u.exec(text)?.[1];
  const named = MONTHS.findIndex((month) => text.includes(month));
  const month = iso ?? (named >= 0 ? String(named + 1).padStart(2, '0') : undefined);
  if (month) return `${year}-${month}-01`;
  return end ? `${year}-12-31` : `${year}-01-01`;
}

function educationLevel(qualification: string): Education['level'] {
  const text = qualification.toLocaleLowerCase('ru');
  if (/phd|doctor|доктор|кандидат наук|аспирант/u.test(text)) return 'doctorate';
  if (/master|магистр|mba|\bmsc\b|\bma\b/u.test(text)) return 'master';
  if (/bachelor|бакалавр|специалист|\bbsc\b|\bba\b|\bbe\b/u.test(text)) return 'bachelor';
  if (/college|колледж|техникум|училищ/u.test(text)) return 'vocational';
  return 'other';
}

/** Trimmed to the schema limit, without the dangling «,» or «—» an import leaves at the end. */
const clip = (value: string) =>
  value
    .trim()
    .replace(/[\s,;:—–-]+$/u, '')
    .slice(0, 160);

const sameSchool = (title: string) =>
  title
    .trim()
    .toLowerCase()
    .replace(/[\s,;:—–-]+$/u, '');

function profileEducation(draft: ResumeDraft, known: readonly Education[]): Education[] {
  const ids = new Set(known.map(({ id }) => id));
  const titles = known.map(({ title }) => sameSchool(title)).filter(Boolean);
  // «МГТУ им. Баумана — Информатика…» from the profile is the «МГТУ им. Баумана» already saved here.
  const savedSchool = (text: string) => {
    const value = sameSchool(text);
    return (
      Boolean(value) &&
      titles.some(
        (title) =>
          value === title || value.startsWith(`${title} `) || value.startsWith(`${title},`),
      )
    );
  };
  return draft.education.flatMap((entry) => {
    const origin = relocationOrigin(entry.id);
    const title = clip(entry.qualification || entry.institution || '');
    const id = rowId(PROFILE_PREFIX, entry.id);
    if (
      !title ||
      ids.has(id) ||
      (origin && ids.has(origin)) ||
      savedSchool(title) ||
      savedSchool(entry.institution ?? '')
    )
      return [];
    const startedAt = profileDate(entry.startDate, false);
    const completedAt = profileDate(entry.endDate, true);
    const ordered = !startedAt || !completedAt || startedAt <= completedAt;
    return [
      {
        id,
        level: educationLevel(title),
        title,
        ...(entry.qualification && entry.institution
          ? { fieldOfStudy: clip(entry.institution) }
          : {}),
        countryCode: '',
        ...(startedAt && ordered ? { startedAt } : {}),
        ...(completedAt ? { completedAt } : {}),
        recognitionStatus: 'unknown' as const,
      },
    ];
  });
}

function profileCertificates(draft: ResumeDraft, known: readonly Certificate[]): Certificate[] {
  const ids = new Set(known.map(({ id }) => id));
  const titles = new Set(known.map(({ title }) => title.trim().toLowerCase()));
  return (draft.certifications ?? []).flatMap((entry) => {
    const id = rowId(PROFILE_PREFIX, entry.id);
    const title = clip(entry.name);
    if (!title || ids.has(id) || titles.has(title.toLowerCase())) return [];
    const issuedAt = profileDate(entry.issuedAt, false);
    const expiresAt = profileDate(entry.expiresAt, true);
    return [
      {
        id,
        title,
        ...(entry.issuer ? { issuer: clip(entry.issuer) } : {}),
        countryCode: '',
        ...(issuedAt ? { issuedAt } : {}),
        ...(expiresAt && (!issuedAt || issuedAt <= expiresAt) ? { expiresAt } : {}),
        recognitionStatus: 'unknown' as const,
      },
    ];
  });
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  english: 'Английский',
  german: 'Немецкий',
  french: 'Французский',
  spanish: 'Испанский',
  italian: 'Итальянский',
  portuguese: 'Португальский',
  serbian: 'Сербский',
  greek: 'Греческий',
  turkish: 'Турецкий',
  arabic: 'Арабский',
  georgian: 'Грузинский',
  armenian: 'Армянский',
  kazakh: 'Казахский',
  chinese: 'Китайский',
  japanese: 'Японский',
  dutch: 'Нидерландский',
  polish: 'Польский',
  hebrew: 'Иврит',
  russian: 'Русский',
  ukrainian: 'Украинский',
  romanian: 'Румынский',
};

function languageName(name: string): string {
  return LANGUAGE_NAMES[name.trim().toLowerCase()] ?? name.trim();
}

function profileLanguages(draft: ResumeDraft, known: readonly Language[]): Language[] {
  const names = new Set(known.map(({ name }) => languageName(name).toLowerCase()));
  return draft.languages.flatMap((entry) => {
    const name = clip(languageName(entry.name ?? ''));
    if (!name || names.has(name.toLowerCase())) return [];
    names.add(name.toLowerCase());
    return [
      {
        id: rowId(PROFILE_PREFIX, entry.id),
        name,
        level: entry.cefr ?? 'unknown',
        source: 'candidate' as const,
        ...(entry.sourceLabel ? { sourceLabel: clip(entry.sourceLabel) } : {}),
        confirmation: 'proposed' as const,
      },
    ];
  });
}

function profileCitizenship(draft: ResumeDraft): string[] {
  const codes = (draft.additional?.citizenship ?? '')
    .split(/[,;/]/u)
    .map((part) => worldCountryCode(part))
    .filter((code): code is string => Boolean(code));
  return [...new Set(codes)];
}

/** The questionnaire as relocation shows it: saved answers first, profile facts added. */
export function mergeProfileFacts(
  questionnaire: Questionnaire,
  draft: ResumeDraft | null,
): Questionnaire {
  if (!draft) return questionnaire;
  const { education, certificates } = questionnaire.education;
  const citizenship = questionnaire.citizenshipDocuments.citizenshipCountryCodes;
  return {
    ...questionnaire,
    citizenshipDocuments: {
      ...questionnaire.citizenshipDocuments,
      citizenshipCountryCodes: citizenship.length
        ? citizenship
        : profileCitizenship(draft).slice(0, 10),
    },
    education: {
      education: [...education, ...profileEducation(draft, education)].slice(0, 20),
      certificates: [...certificates, ...profileCertificates(draft, certificates)].slice(0, 30),
    },
    languages: {
      languages: [
        ...questionnaire.languages.languages,
        ...profileLanguages(draft, questionnaire.languages.languages),
      ].slice(0, 30),
    },
  };
}

function withCitizenship(draft: ResumeDraft, questionnaire: Questionnaire): ResumeDraft | null {
  const names = questionnaire.citizenshipDocuments.citizenshipCountryCodes
    .map((code) => worldCountryName(code) ?? code)
    .join(', ');
  if ((draft.additional?.citizenship ?? '') === names) return null;
  const { citizenship: _previous, ...rest } = draft.additional ?? {};
  return { ...draft, additional: names ? { ...rest, citizenship: names } : rest };
}

function withEducation(draft: ResumeDraft, questionnaire: Questionnaire): ResumeDraft | null {
  const present = new Set(draft.education.map(({ id }) => id));
  const added = questionnaire.education.education
    .filter(({ id }) => !isProfileFactRow(id) && !present.has(rowId(RELOCATION_PREFIX, id)))
    .map((row) => ({
      id: rowId(RELOCATION_PREFIX, row.id),
      evidenceMemoryId: `manual-${row.id}`.slice(0, 80),
      qualification: row.title,
      ...(row.fieldOfStudy ? { institution: row.fieldOfStudy } : {}),
      ...(row.startedAt ? { startDate: row.startedAt.slice(0, 7) } : {}),
      ...(row.completedAt ? { endDate: row.completedAt.slice(0, 7) } : {}),
    }));
  return added.length ? { ...draft, education: [...draft.education, ...added] } : null;
}

function withLanguages(draft: ResumeDraft, questionnaire: Questionnaire): ResumeDraft | null {
  const names = new Set(draft.languages.map(({ name }) => languageName(name ?? '').toLowerCase()));
  const added = questionnaire.languages.languages
    .filter(({ id, name }) => !isProfileFactRow(id) && !names.has(languageName(name).toLowerCase()))
    .map((row) => ({
      id: rowId(RELOCATION_PREFIX, row.id),
      evidenceMemoryId: `manual-${row.id}`.slice(0, 80),
      name: row.name,
      ...(row.level === 'unknown' ? {} : { cefr: row.level }),
    }));
  return added.length ? { ...draft, languages: [...draft.languages, ...added] } : null;
}

/** The profile after one saved relocation step, or null when it already holds everything. */
export function applyRelocationStepToDraft(
  draft: ResumeDraft,
  step: RelocationStepId,
  questionnaire: Questionnaire,
): ResumeDraft | null {
  if (step === 'citizenship_documents') return withCitizenship(draft, questionnaire);
  if (step === 'education') return withEducation(draft, questionnaire);
  if (step === 'languages') return withLanguages(draft, questionnaire);
  return null;
}
