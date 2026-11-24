import type { HhResumeEdit, HhResumeSections } from '../../shared/hhCandidateSession';

/**
 * B678: правки резюме hh.ru «было → станет». Платформа ничего не придумывает: «станет» — то, что
 * она уже написала и кандидат подтвердил: пункты места работы мастер-резюме (с фактами консультанта),
 * «о себе», навыки, которые подтверждает профиль, и название вакансии для должности. Текст на другом
 * языке помечен своим языком: его переводят до показа, непереведённое не показывается.
 */
export type HhEditLanguage = 'ru' | 'en';

export interface HhPlatformPlace {
  readonly id: string;
  readonly employer: string;
  /** Настоящее название вместо маски LinkedIn и другие имена той же компании. */
  readonly aliases: readonly string[];
  readonly bullets: readonly string[];
}

export interface HhEditsInput {
  readonly resume: { readonly id: string; readonly title: string; readonly sections: HhResumeSections };
  /** Заголовки остальных резюме кандидата: hh.ru требует уникальных. */
  readonly otherTitles: readonly string[];
  readonly vacancy: {
    readonly title: string;
    /** Название — роль, родственная целевым ролям кандидата: иначе должность в резюме не меняется. */
    readonly titleFits: boolean;
    readonly requirements: readonly string[];
  };
  readonly platform: {
    readonly about: string | null;
    readonly places: readonly HhPlatformPlace[];
    /** Тексты подтверждённых фактов профиля: навык добавляется, только если он здесь есть. */
    readonly facts: readonly string[];
  };
}

export interface HhEditDraft extends HhResumeEdit {
  readonly language: HhEditLanguage;
  /** Пункты места работы по одному: их переводят по отдельности. */
  readonly lines?: readonly string[];
}

const PLACE_LINES_MAX = 8;
const TITLE_MAX = 100;
/** Короче трёх символов ключ работодателя совпадает с чужими названиями («IT», «A»). */
const EMPLOYER_KEY_MIN = 3;
/** Навык длиннее — не навык, а фраза из описания вакансии. */
const SKILL_MAX = 80;
const LEGAL_FORMS = /(?<![\p{L}\p{N}])(?:ооо|оао|ао|пао|зао|нао|ип|llc|ltd|inc|gmbh|plc|bhd|berhad|sdn)(?![\p{L}\p{N}])/giu;

function normalized(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

const contains = (text: string, phrase: string) => {
  const needle = normalized(phrase);
  return needle.length > 0 && ` ${normalized(text)} `.includes(` ${needle} `);
};

export function languageOf(text: string): HhEditLanguage {
  const cyrillic = (text.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  return cyrillic >= latin ? 'ru' : 'en';
}

export function hhResumeLanguage(sections: HhResumeSections): HhEditLanguage {
  return languageOf([sections.about, ...sections.places.map((place) => place.text)].join(' '));
}

function employerKey(name: string): string {
  return normalized(name.replace(LEGAL_FORMS, ' '));
}

function samePlace(hhEmployer: string, place: HhPlatformPlace): boolean {
  const hh = employerKey(hhEmployer);
  if (hh.length < EMPLOYER_KEY_MIN) return false;
  return [place.employer, ...place.aliases].some((name) => {
    const key = employerKey(name);
    return key.length >= EMPLOYER_KEY_MIN && (` ${hh} `.includes(` ${key} `) || ` ${key} `.includes(` ${hh} `));
  });
}

function titleEdit(input: HhEditsInput): HhEditDraft[] {
  const was = input.resume.sections.title || input.resume.title;
  const now = input.vacancy.title.trim().slice(0, TITLE_MAX);
  const taken = input.otherTitles.some((title) => normalized(title) === normalized(now));
  if (!input.vacancy.titleFits || !now || taken || contains(was, now)) return [];
  return [{ id: 'title', section: 'title', was, now, language: languageOf(now) }];
}

/** Каждое место профиля платформы достаётся не больше чем одному месту hh.ru: первому совпавшему. */
function matchedPlaces(input: HhEditsInput): ReadonlyArray<HhPlatformPlace | undefined> {
  return input.resume.sections.places.reduce<{ readonly used: ReadonlySet<string>; readonly found: Array<HhPlatformPlace | undefined> }>(
    (state, place) => {
      const source = input.platform.places.find((candidate) => !state.used.has(candidate.id) && samePlace(place.employer, candidate));
      return {
        used: source ? new Set([...state.used, source.id]) : state.used,
        found: [...state.found, source],
      };
    },
    { used: new Set(), found: [] },
  ).found;
}

function experienceEdits(input: HhEditsInput): HhEditDraft[] {
  const sources = matchedPlaces(input);
  return input.resume.sections.places.flatMap((place, index) => {
    const source = sources[index];
    const lines = (source?.bullets ?? []).map((line) => line.trim()).filter(Boolean).slice(0, PLACE_LINES_MAX);
    const now = lines.join('\n');
    if (lines.length === 0 || normalized(now) === normalized(place.text)) return [];
    return [
      {
        id: `experience:${index}`,
        section: 'experience' as const,
        place: [place.employer, place.period].filter(Boolean).join(' · '),
        employer: place.employer,
        position: place.title,
        was: place.text,
        now,
        language: languageOf(now),
        lines,
      },
    ];
  });
}

function skillsEdit(input: HhEditsInput): HhEditDraft[] {
  const { sections } = input.resume;
  const resumeText = [sections.title, sections.about, ...sections.skills, ...sections.places.map((place) => place.text)].join(' ');
  const added = input.vacancy.requirements.filter(
    (requirement) =>
      requirement.trim() &&
      requirement.trim().length <= SKILL_MAX &&
      !contains(resumeText, requirement) &&
      input.platform.facts.some((fact) => contains(fact, requirement)),
  );
  if (added.length === 0) return [];
  const was = sections.skills.join(', ');
  const now = [...sections.skills, ...added.map((item) => item.trim())].join(', ');
  const trimmed = added.map((item) => item.trim());
  return [{ id: 'skills', section: 'skills', was, now, language: hhResumeLanguage(sections), added: trimmed }];
}

/** Условия поиска из старых снимков («Уровень дохода не указан · Постоянная работа …») — не «О себе». */
function isPositionTerms(text: string): boolean {
  if (/^\s*уровень дохода не указан/iu.test(text)) return true;
  const terms = text.match(
    /постоянная работа|подработка|полная занятость|частичная занятость|гибрид|удал[её]нно|на месте работодателя|командировк/giu,
  );
  return text.length < 300 && (terms?.length ?? 0) >= 3;
}

function aboutEdit(input: HhEditsInput): HhEditDraft[] {
  const now = input.platform.about?.trim() ?? '';
  const was = input.resume.sections.about;
  if (!now || isPositionTerms(was) || normalized(now) === normalized(was)) return [];
  return [{ id: 'about', section: 'about', was, now, language: languageOf(now) }];
}

export function draftHhResumeEdits(input: HhEditsInput): HhEditDraft[] {
  return [...titleEdit(input), ...experienceEdits(input), ...skillsEdit(input), ...aboutEdit(input)];
}
