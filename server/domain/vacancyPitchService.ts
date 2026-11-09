import { PERSON_FIRST_NAMES } from '../../shared/personFirstNames';
import { stripHiddenMarkers } from '../../shared/textHygiene';
import { isImportedMemoryId } from './resumeImport';
import {
  hasRoleAwarePitchRanking,
  rankPitchFacts,
  type PitchFactRankingContext,
} from './pitchFactRanking';
import {
  englishJobTitle,
  englishProperName,
  hasCyrillic,
  letterEmployerName,
  requirementLabel,
  russianJobTitle,
} from './letterLanguage';
import {
  isResultFact,
  isStructuredRecordStatement,
  lowerLetterStart,
  orderLetterResults,
  resultFirst,
  withTranslatedStatements,
} from './letterResults';

export { isStructuredRecordStatement } from './letterResults';

export type PitchTone = 'executive' | 'confident' | 'technical';
export type PitchLanguage = 'en' | 'ru';

/**
 * Откуда взят факт, попавший в письмо.
 *
 * `confirmed` — кандидат подтвердил или поправил факт в беседе.
 * `imported` — факт пришёл из импорта резюме/профиля и ещё не подтверждён
 * кандидатом (`status: 'proposed'`), но источник — собственные данные
 * кандидата, а не домысел модели. Отрицательные и отклонённые факты сюда не
 * попадают (см. `isNegativeStatement`) — только их формально не хватает
 * статуса «подтверждено».
 */
export type PitchFactBasis = 'confirmed' | 'imported';

export interface VacancyPitchInputFact {
  readonly id: string;
  readonly statement: string;
  readonly domain?: string;
  readonly kind?: string;
  readonly sourceMessageIds?: readonly string[];
  readonly sensitive?: boolean;
  readonly status?: 'proposed' | 'confirmed' | 'corrected';
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface VacancyPitchInputVacancy {
  readonly id: string;
  readonly title: string;
  readonly company?: string;
  readonly description?: string;
  readonly requiredSkills?: readonly string[];
  readonly responsibilities?: readonly string[];
  readonly location?: string;
  readonly isRemote?: boolean;
}

export interface PitchRecipient {
  readonly name?: string;
  readonly role?: string;
}

export interface GenerateVacancyPitchOptions {
  readonly vacancy: VacancyPitchInputVacancy;
  readonly candidateName?: string;
  /** Имя на языке письма, как его вернула модель (B624): заменяет имя из профиля в подписи и теме. */
  readonly letterName?: string;
  readonly facts: readonly VacancyPitchInputFact[];
  readonly tone?: PitchTone;
  /** Переопределяет язык, иначе он определяется по тексту вакансии. */
  readonly language?: PitchLanguage;
  /** Контекст разбора роли сохраняет один порядок для шаблона и модели. */
  readonly rankingContext?: PitchFactRankingContext;
  readonly recipient?: PitchRecipient;
  /** B422: кандидат отметил компанию вакансии «Хочу в эту компанию». */
  readonly targetCompany?: boolean;
  /** B528: места работы, выбранные кандидатом для письма, в порядке профиля. */
  readonly workplaces?: readonly PitchWorkplace[];
  /** G3b: пункты мест работы, переведённые на язык письма (id факта → текст). */
  readonly translations?: ReadonlyMap<string, string>;
}

export interface PitchWorkplace {
  readonly employer: string | null;
  readonly title: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly current: boolean;
  /** Запись хронологии о самом месте: она называет место, но не результат. */
  readonly recordId?: string | null;
  readonly evidenceIds: readonly string[];
}

export interface VacancyPitchUsedFact {
  readonly id: string;
  readonly basis: PitchFactBasis;
}

export interface VacancyPitchResponse {
  readonly vacancyId: string;
  readonly emailPitch: {
    readonly subject: string;
    readonly body: string;
  };
  readonly linkedInNote: string;
  readonly atsCoverLetter: string;
  readonly contactMessage: string;
  readonly usedEvidenceIds: readonly string[];
  readonly usedFacts: readonly VacancyPitchUsedFact[];
  /** Требования вакансии, на которые письмо ответило конкретным фактом профиля (C46). */
  readonly coveredRequirements: readonly string[];
  /** Требования без подтверждающего факта, подписями для человека (G3 L2). */
  readonly unconfirmedRequirements: readonly string[];
  /** Имя из резюме, как оно написано в письме; нет имени — нет и подписи. */
  readonly senderName?: string;
  /** Только имя для письма знакомому; нет, если имя не распознано. */
  readonly senderFirstName?: string;
  readonly language: PitchLanguage;
  /**
   * Состояние «мало фактов» уходит сюда, а не
   * в тело письма: кандидат копирует тело рекрутеру как есть, и служебный
   * текст об отсутствии данных там читать не должен никто, кроме кандидата.
   */
  readonly notices: readonly string[];
  readonly generatedAt: string;
}

const LINKEDIN_NOTE_LIMIT = 300;
const CONTACT_MESSAGE_LIMIT = 600;

/** При token-limit сохраняем только предложения, которые модель успела закончить. */
export function trimIncompleteFinalSentence(text: string): string {
  const endings = Array.from(text.matchAll(/[.!?](?:["'»”\])]+)?(?=\s|$)/gu));
  if (endings.length < 2) return '';
  const last = endings.at(-1);
  return last?.index === undefined ? '' : text.slice(0, last.index + last[0].length).trim();
}

function isNegativeStatement(statement: string): boolean {
  return /(не\s+(имею|работал|владею|знаю)|нет\s+опыта|без\s+опыта|никогда\s+не)/iu.test(statement);
}

/**
 * Определяет язык вакансии по заголовку и описанию: кириллица — русский,
 * иначе — английский. Явный параметр запроса всегда важнее (B266).
 */
export function detectVacancyLanguage(vacancy: VacancyPitchInputVacancy): PitchLanguage {
  const text = `${vacancy.title} ${vacancy.description ?? ''} ${(vacancy.responsibilities ?? []).join(' ')}`;
  return /\p{Script=Cyrillic}/u.test(text) ? 'ru' : 'en';
}

function factBasis(fact: VacancyPitchInputFact): PitchFactBasis {
  return fact.status === 'confirmed' || fact.status === 'corrected' ? 'confirmed' : 'imported';
}

/**
 * Факты, годные для внешнего письма.
 *
 * Раньше сюда попадали только `confirmed`/`corrected` — импортированные из
 * резюме факты кандидата (`proposed`) молча давали ноль фактов (B266).
 * Отрицательные и отклонённые формулировки по-прежнему исключены: кандидат
 * не должен процитировать рекрутеру то, чего у него нет.
 */
/** Notes the consultant kept about the import itself are not candidate evidence. */
function isAboutTheImportItself(statement: string): boolean {
  return /импортировал|импорт резюме|imported (?:a|the|his|her) (?:resume|profile)/iu.test(
    statement,
  );
}

/**
 * Экспортируется для сопроводительного письма от модели (B266, пункт 7):
 * тот же фильтр, что и у шаблона — импорт-о-себе и отрицания не должны
 * попасть в вызов модели, если их не пускают в шаблонное письмо.
 */
export function filterUsablePitchFacts(
  facts: readonly VacancyPitchInputFact[],
): VacancyPitchInputFact[] {
  return filterUsableFacts(facts);
}

function filterUsableFacts(facts: readonly VacancyPitchInputFact[]): VacancyPitchInputFact[] {
  return facts.filter(
    (fact) =>
      (fact.status === 'confirmed' ||
        fact.status === 'corrected' ||
        (fact.status === 'proposed' && isImportedMemoryId(fact.id))) &&
      !isAboutTheImportItself(fact.statement) &&
      fact.kind === 'fact' &&
      fact.sensitive !== true &&
      Boolean(fact.statement.trim()) &&
      !isNegativeStatement(fact.statement) &&
      (fact.sourceMessageIds?.length ?? 0) > 0,
  );
}

function truncateSafely(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const sliced = text.slice(0, maxLen - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const boundary = lastSpace > maxLen / 2 ? lastSpace : maxLen - 1;
  const trimmed = sliced.slice(0, boundary).trim();
  const punct = /[.,;!?-]$/u.test(trimmed) ? '' : '.';
  return `${trimmed}${punct}`;
}

interface Copy {
  /** Тема — «Должность — Имя Фамилия», без хвоста при любом тоне (решение 08.11). */
  subject(title: string, candidateName: string): string;
  intro(title: string, company: string | undefined, tone: PitchTone): string;
  /** B422: кандидат отметил компанию «Хочу в эту компанию». */
  targetCompany(company: string): string;
  evidenceIntro: string;
  experienceSnippet(statement: string): string;
  stackMatched(skills: string): string;
  closing(tone: PitchTone): string;
  linkedIn(vacancy: VacancyPitchInputVacancy, tone: PitchTone, snippet: string): string;
  ats: {
    to(companyLine: string): string;
    position: string;
    candidate: string;
    greeting(company: string | undefined): string;
    resultsHeading: string;
    experienceHeading: string;
    fitHeading: string;
    signOff: string;
  };
  contactGreeting(name: string): string;
  contactGreetingGeneric: string;
  contactIntro(candidateName: string, title: string, company?: string): string;
  contactFacts(statements: readonly string[]): string;
  contactClosing(tone: PitchTone): string;
  companyFallback: string;
  candidateFallback: string;
  noticeNoFacts: string;
}

const RU_COPY: Copy = {
  subject: (title, candidateName) => `${title} — ${candidateName}`,
  intro: (title, company, tone) => {
    const target = company ? 'компании ' + company : 'вашей команды';
    const opening =
      tone === 'confident'
        ? 'Направляю отклик и хочу обсудить задачи роли.'
        : tone === 'technical'
          ? 'Хочу обсудить технический контекст и ожидания команды.'
          : 'Хочу узнать больше о целях и приоритетах роли.';
    return 'Здравствуйте! Заинтересовала вакансия ' + title + ' в ' + target + '. ' + opening;
  },
  targetCompany: (company) => `${company} — компания, в которой я хочу работать.`,
  evidenceIntro: 'Из результатов:',
  experienceSnippet: (statement) => ` Мой опыт: ${statement}.`,
  stackMatched: (skills) => `В профиле подтверждён практический опыт работы со стеком: ${skills}`,
  closing: (tone) => {
    if (tone === 'technical') {
      return 'Предлагаю разобрать технические вопросы и архитектурные кейсы на короткой встрече.';
    }
    if (tone === 'confident') {
      return 'Предлагаю созвониться на 15 минут, чтобы предметно обсудить задачи и взаимные ожидания.';
    }
    return 'Предлагаю обсудить цели роли и приоритеты бизнеса на коротком звонке.';
  },
  linkedIn: (vacancy, tone, snippet) => {
    const companyPart = vacancy.company ? ` в ${vacancy.company}` : '';
    if (tone === 'technical') {
      return `Здравствуйте! Заинтересовала позиция ${vacancy.title}${companyPart}.${snippet} Хочу обсудить инженерные вызовы и добавить вас в сеть!`;
    }
    if (tone === 'confident') {
      return `Здравствуйте! Откликаюсь на роль ${vacancy.title}${companyPart}.${snippet} Предлагаю обсудить задачи на коротком звонке.`;
    }
    return `Здравствуйте! Заинтересовала роль ${vacancy.title}${companyPart}.${snippet} Хочу обсудить задачи команды и добавить вас в сеть контактов!`;
  },
  ats: {
    to: (companyLine) => `Кому: Нанимающей команде ${companyLine}`,
    position: 'Позиция',
    candidate: 'Кандидат',
    greeting: (company) => `Уважаемая команда${company ? ` ${company}` : ''}!`,
    resultsHeading: 'Ключевые результаты:',
    experienceHeading: 'Опыт:',
    fitHeading: 'Соответствие требованиям роли:',
    signOff: 'С уважением,',
  },
  contactGreeting: (name) => `Здравствуйте, ${name}!`,
  contactGreetingGeneric: 'Здравствуйте!',
  contactIntro: (candidate, title, company) => {
    const atCompany = company ? ` в ${company}` : '';
    return `Меня зовут ${candidate}, пишу по поводу позиции ${title}${atCompany}.`;
  },
  contactFacts: (statements) => `Коротко о моём опыте: ${joinSentences(statements)}`,
  contactClosing: (tone) => {
    if (tone === 'technical') {
      return 'Предлагаю обсудить инженерные задачи и ответить на вопросы.';
    }
    if (tone === 'confident') {
      return 'Предлагаю созвониться на 15 минут для предметного знакомства.';
    }
    return 'Предлагаю короткий звонок, чтобы обсудить задачи роли и взаимные ожидания.';
  },
  companyFallback: 'вашей команды',
  candidateFallback: 'Кандидат',
  noticeNoFacts: 'В профиле пока нет фактов, годных для письма — добавьте их перед отправкой.',
};

const EN_COPY: Copy = {
  subject: (title, candidateName) => `${title} — ${candidateName}`,
  intro: (title, company, tone) => {
    const target = company ? `at ${company}` : 'on your team';
    const opening =
      tone === 'confident'
        ? "I'm submitting my application and would be glad to discuss the role's scope."
        : tone === 'technical'
          ? "I'd be glad to discuss the technical context and the team's expectations."
          : "I'd be glad to learn more about the role's goals and priorities.";
    return `Hello! I'm interested in the ${title} role ${target}. ${opening}`;
  },
  targetCompany: (company) => `${company} is a company I want to work for.`,
  evidenceIntro: 'Among my results:',
  experienceSnippet: (statement) => ` My experience: ${statement}.`,
  stackMatched: (skills) => `My profile confirms hands-on experience with: ${skills}`,
  closing: (tone) => {
    if (tone === 'technical') {
      return "I'd be glad to answer technical questions and walk through architecture cases on a short call.";
    }
    if (tone === 'confident') {
      return "Let's set up a 15-minute call to discuss the role's scope and mutual expectations.";
    }
    return "I'd be glad to discuss the role's goals and business priorities on a short call.";
  },
  linkedIn: (vacancy, tone, snippet) => {
    const companyPart = vacancy.company ? ` at ${vacancy.company}` : '';
    if (tone === 'technical') {
      return `Hello! I'm interested in the ${vacancy.title} role${companyPart}.${snippet} I'd be glad to discuss engineering challenges and connect!`;
    }
    if (tone === 'confident') {
      return `Hello! Applying for the ${vacancy.title} role${companyPart}.${snippet} Happy to discuss the role on a short call — great to connect!`;
    }
    return `Hello! I'm interested in the ${vacancy.title} role${companyPart}.${snippet} I'd be glad to discuss the team's scope and connect!`;
  },
  ats: {
    to: (companyLine) => `To: Hiring team, ${companyLine}`,
    position: 'Position',
    candidate: 'Candidate',
    greeting: (company) => `Dear ${company ?? 'Hiring'} Team,`,
    resultsHeading: 'Key results:',
    experienceHeading: 'Experience:',
    fitHeading: 'Fit against the role requirements:',
    signOff: 'Best regards,',
  },
  contactGreeting: (name) => `Hello ${name}!`,
  contactGreetingGeneric: 'Hello!',
  contactIntro: (candidate, title, company) => {
    const atCompany = company ? ` at ${company}` : '';
    return `My name is ${candidate}, reaching out regarding the ${title} role${atCompany}.`;
  },
  contactFacts: (statements) => `Briefly on my background: ${joinSentences(statements)}`,
  contactClosing: (tone) => {
    if (tone === 'technical') {
      return "I'd be glad to discuss engineering challenges and answer any questions.";
    }
    if (tone === 'confident') {
      return "Let's set up a quick 15-minute call to discuss mutual fit.";
    }
    return "I'd welcome a brief call to discuss the role's scope and expectations.";
  },
  companyFallback: 'your team',
  candidateFallback: 'Candidate',
  noticeNoFacts: 'No profile facts are ready for this letter yet — add them before sending.',
};

function copyFor(language: PitchLanguage): Copy {
  return language === 'en' ? EN_COPY : RU_COPY;
}

function yearOf(date: string | null): string | null {
  return date?.match(/\d{4}/u)?.[0] ?? null;
}

function workplacePeriod(place: PitchWorkplace, language: PitchLanguage): string {
  const start = yearOf(place.startDate);
  const end = place.current ? (language === 'ru' ? 'по сей день' : 'present') : yearOf(place.endDate);
  if (!start) return '';
  return end && end !== start ? ` (${start}–${end})` : ` (${start})`;
}

interface WorkplacePhrase {
  readonly text: string;
  readonly hasTitle: boolean;
}

/** Письмо на одном языке: и должность на нём, и компания как у кандидата (G3 L1, G3c). */
function workplaceParts(place: PitchWorkplace, language: PitchLanguage) {
  const title = place.title?.trim() || null;
  const employer = place.employer?.trim() || null;
  if (language === 'ru') return { title: title ? russianJobTitle(title) : null, employer };
  return {
    title: title ? englishJobTitle(title) : null,
    employer: employer ? letterEmployerName(employer) : null,
  };
}

function workplacePhrase(place: PitchWorkplace, language: PitchLanguage): WorkplacePhrase | null {
  const { title, employer } = workplaceParts(place, language);
  if (!title && !employer) return null;
  const joiner = language === 'ru' ? ' в компании ' : ' at ';
  const head = title && employer ? `${title}${joiner}${employer}`
    : (title ?? `${language === 'ru' ? 'в компании ' : 'at '}${employer ?? ''}`);
  return { text: `${head}${workplacePeriod(place, language)}`, hasTitle: Boolean(title) };
}

/** Человеческая фраза о выбранных местах работы; их id — следы фактов (B528). */
export function buildWorkplaceSentence(
  workplaces: readonly PitchWorkplace[],
  language: PitchLanguage,
  usedIds?: Set<string>,
): string {
  const phrases = workplaces.slice(0, 3).flatMap((place) => {
    const phrase = workplacePhrase(place, language);
    if (!phrase) return [];
    for (const id of place.evidenceIds) usedIds?.add(id);
    return [phrase];
  });
  if (phrases.length === 0) return '';
  const [first, ...others] = phrases;
  if (!first) return '';
  const rest = others.map((phrase) => phrase.text);
  if (language === 'ru') {
    const now = workplaces[0]?.current
      ? (first.hasTitle ? 'Сейчас работаю на позиции' : 'Сейчас работаю')
      : 'Последнее место —';
    return rest.length ? `${now} ${first.text}; до этого — ${rest.join(', ')}.` : `${now} ${first.text}.`;
  }
  const verb = workplaces[0]?.current ? 'I currently work' : 'Most recently I worked';
  const now = first.hasTitle ? `${verb} as` : verb;
  return others.length
    ? `${now} ${first.text}; before that, I ${englishEarlierPlaces(others)}.`
    : `${now} ${first.text}.`;
}

/** «was Director of Engineering at A (…) and worked at B (…)»: место без должности не висит на «at». */
function englishEarlierPlaces(phrases: readonly WorkplacePhrase[]): string {
  const clauses = phrases.map((phrase, index) => {
    if (!phrase.hasTitle) return `worked ${phrase.text}`;
    return phrases[index - 1]?.hasTitle ? phrase.text : `was ${phrase.text}`;
  });
  if (clauses.length < 2) return clauses.join('');
  return `${clauses.slice(0, -1).join(', ')} and ${clauses.at(-1) ?? ''}`;
}

/**
 * Факты, которые можно процитировать рекрутеру как результат: без записей
 * профиля «Поле: значение» и на языке письма — шаблон не переводит.
 */
function letterResultFacts(
  facts: readonly VacancyPitchInputFact[],
  language: PitchLanguage,
): VacancyPitchInputFact[] {
  return facts.filter((fact) => !isStructuredRecordStatement(fact.statement) &&
    (language === 'ru' || !hasCyrillic(fact.statement)) && isResultFact(fact));
}

function buildEvidenceParagraph(
  copy: Copy,
  language: PitchLanguage,
  facts: readonly VacancyPitchInputFact[],
  workplaces: readonly PitchWorkplace[],
  usedIds: Set<string>,
  notices: string[],
  useRanking: boolean,
): string {
  const career = buildWorkplaceSentence(workplaces, language, usedIds);
  if (facts.length === 0) {
    // The "too few facts" state is not letter content — it goes to `notices`
    // and the paragraph is simply omitted (B266).
    if (!career) notices.push(copy.noticeNoFacts);
    return career;
  }
  const metricFact = useRanking
    ? facts[0]
    : facts.find((f) => f.domain === 'outcome' || /\d+/u.test(f.statement)) ?? facts[0];
  if (metricFact) usedIds.add(metricFact.id);
  const otherFacts = facts.filter((f) => f.id !== metricFact?.id).slice(0, 2);
  for (const f of otherFacts) usedIds.add(f.id);
  const statements = [metricFact?.statement, ...otherFacts.map((f) => f.statement)].filter(
    (s): s is string => Boolean(s),
  );
  const employers = new Set(workplaces.flatMap((place) => place.employer?.split(/\s+/u) ?? []));
  const results = statements.map((statement, index) => {
    const text = resultFirst(statement, language);
    return index === 0 ? lowerLetterStart(text, language, employers) : text.charAt(0).toLocaleUpperCase() + text.slice(1);
  });
  return [career, `${copy.evidenceIntro} ${joinSentences(results)}`].filter(Boolean).join(' ');
}

/** Факты часто уже кончаются точкой — склейка не должна давать «..» (прод 25.09). */
function joinSentences(statements: readonly string[]): string {
  return statements
    .map((statement) => statement.trim().replace(/[.;,\s]+$/u, ''))
    .filter(Boolean)
    .map((statement) => `${statement}.`)
    .join(' ');
}

function hasPositiveSkillEvidence(fact: VacancyPitchInputFact, requirement: string): boolean {
  if (fact.domain !== 'skill') return false;
  const statement = fact.statement.toLocaleLowerCase();
  const skill = requirement.toLocaleLowerCase();
  if (
    !new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(skill)}([^\\p{L}\\p{N}]|$)`, 'iu').test(
      statement,
    )
  ) {
    return false;
  }
  return !isNegativeStatement(statement);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Требования вакансии, подтверждённые фактом профиля, и их доказательства.
 * Общая проверка для абзаца про стек и для `coveredRequirements` в ответе
 * API (C46) — оба должны согласиться, что именно письмо покрыло.
 */
function matchRequirements(
  reqSkills: readonly string[],
  facts: readonly VacancyPitchInputFact[],
): { matched: string[]; missing: string[]; matchedIds: string[] } {
  const matched: string[] = [];
  const missing: string[] = [];
  const matchedIds: string[] = [];
  for (const req of reqSkills) {
    const matchedFact = facts.find((f) => hasPositiveSkillEvidence(f, req));
    if (matchedFact) {
      matched.push(req);
      matchedIds.push(matchedFact.id);
    } else {
      missing.push(req);
    }
  }
  return { matched, missing, matchedIds };
}

/**
 * Непокрытые требования — не текст письма и не служебная строка с ключами:
 * они уходят в `unconfirmedRequirements` подписями для человека (G3 L2).
 */
function buildStackParagraph(
  copy: Copy,
  vacancy: VacancyPitchInputVacancy,
  facts: readonly VacancyPitchInputFact[],
  usedIds: Set<string>,
): string {
  const reqSkills = vacancy.requiredSkills ?? [];
  if (reqSkills.length === 0) return '';
  const { matched, matchedIds } = matchRequirements(reqSkills, facts);
  for (const id of matchedIds) usedIds.add(id);
  return matched.length > 0 ? `${copy.stackMatched(matched.map(requirementLabel).join(', '))}.` : '';
}

function buildLinkedInNote(
  copy: Copy,
  vacancy: VacancyPitchInputVacancy,
  facts: readonly VacancyPitchInputFact[],
  tone: PitchTone,
  usedIds: Set<string>,
  useRanking: boolean,
): string {
  const firstFact = useRanking
    ? facts[0]
    : facts.find((f) => f.domain === 'outcome' || /\d+/u.test(f.statement)) ?? facts[0];
  let snippet = '';
  if (firstFact) {
    usedIds.add(firstFact.id);
    snippet = copy.experienceSnippet(firstFact.statement.trim().replace(/[.;,\s]+$/u, ''));
  }
  const note = copy.linkedIn(vacancy, tone, firstFact ? snippet : '');
  return truncateSafely(note, LINKEDIN_NOTE_LIMIT);
}

/** Заголовок без содержимого кандидату не нужен — раздел просто опускается. */
function section(heading: string, body: string): string[] {
  return body.trim() ? [heading, body, ''] : [];
}

function buildAtsCoverLetter(
  copy: Copy,
  vacancy: VacancyPitchInputVacancy,
  candidateName: string,
  intro: string,
  evidence: { readonly text: string; readonly hasResults: boolean },
  stack: string,
  closing: string,
): string {
  const companyLine = vacancy.company ? vacancy.company : copy.companyFallback;
  return [
    copy.ats.to(companyLine),
    `${copy.ats.position}: ${vacancy.title}`,
    `${copy.ats.candidate}: ${candidateName}`,
    '',
    copy.ats.greeting(vacancy.company),
    '',
    intro,
    '',
    ...section(evidence.hasResults ? copy.ats.resultsHeading : copy.ats.experienceHeading, evidence.text),
    ...section(copy.ats.fitHeading, stack),
    closing,
    '',
    copy.ats.signOff,
    candidateName,
  ].join('\n');
}

function buildContactMessage(
  copy: Copy,
  vacancy: VacancyPitchInputVacancy,
  candidateName: string,
  facts: readonly VacancyPitchInputFact[],
  tone: PitchTone,
  recipient: PitchRecipient | undefined,
  usedIds: Set<string>,
  useRanking: boolean,
): string {
  const greeting = recipient?.name
    ? copy.contactGreeting(recipient.name)
    : copy.contactGreetingGeneric;
  const intro = copy.contactIntro(candidateName, vacancy.title, vacancy.company);

  const selectedFacts: VacancyPitchInputFact[] = [];
  const primaryFact = useRanking
    ? facts[0]
    : facts.find((f) => f.domain === 'outcome' || /\d+/u.test(f.statement)) ?? facts[0];
  if (primaryFact) {
    selectedFacts.push(primaryFact);
    usedIds.add(primaryFact.id);
  }
  const secondaryFact = facts.find((f) => f.id !== primaryFact?.id);
  if (secondaryFact) {
    selectedFacts.push(secondaryFact);
    usedIds.add(secondaryFact.id);
  }

  const factSnippet =
    selectedFacts.length > 0 ? copy.contactFacts(selectedFacts.map((f) => f.statement)) : '';
  const cta = copy.contactClosing(tone);
  const parts = [greeting, intro, factSnippet, cta].filter(Boolean);
  return truncateSafely(parts.join(' '), CONTACT_MESSAGE_LIMIT);
}

function assemblePitches(params: {
  copy: Copy;
  vacancy: VacancyPitchInputVacancy;
  candidateName: string;
  usableFacts: readonly VacancyPitchInputFact[];
  tone: PitchTone;
  recipient?: PitchRecipient;
  usedIds: Set<string>;
  notices: string[];
  useRanking: boolean;
  targetCompany?: boolean;
  language: PitchLanguage;
  workplaces: readonly PitchWorkplace[];
}) {
  const { copy, vacancy, candidateName, usableFacts, tone, recipient, usedIds, notices, useRanking } = params;
  const wish = params.targetCompany && vacancy.company ? ` ${copy.targetCompany(vacancy.company)}` : '';
  const intro = copy.intro(vacancy.title, vacancy.company, tone) + wish;
  const results = orderLetterResults(letterResultFacts(usableFacts, params.language), params.workplaces);
  const evidence = buildEvidenceParagraph(copy, params.language, results, params.workplaces, usedIds, notices, useRanking);
  const stack = buildStackParagraph(copy, vacancy, usableFacts, usedIds);
  const closing = copy.closing(tone);
  return {
    emailBody: [intro, evidence, stack, closing].filter((p) => p.length > 0).join('\n\n'),
    linkedInNote: buildLinkedInNote(copy, vacancy, results, tone, usedIds, useRanking),
    atsCoverLetter: buildAtsCoverLetter(copy, vacancy, candidateName, intro, { text: evidence, hasResults: results.length > 0 }, stack, closing),
    contactMessage: buildContactMessage(copy, vacancy, candidateName, results, tone, recipient, usedIds, useRanking),
  };
}

function buildUsedFacts(
  usedIds: Set<string>,
  usableFacts: readonly VacancyPitchInputFact[],
): VacancyPitchUsedFact[] {
  const basisById = new Map(usableFacts.map((fact) => [fact.id, factBasis(fact)] as const));
  return Array.from(usedIds).map((id) => ({ id, basis: basisById.get(id) ?? 'imported' }));
}

function letterSender(
  ownName: string | undefined,
  language: PitchLanguage,
  letterName: string | undefined,
): Pick<VacancyPitchResponse, 'senderName' | 'senderFirstName'> {
  // Модель пишет сначала имя, потом фамилию (запрос B624): первое слово и есть имя.
  if (letterName) {
    const [first] = letterName.split(/\s+/u);
    return { senderName: letterName, ...(first && first !== letterName ? { senderFirstName: first } : {}) };
  }
  if (!ownName) return {};
  const inLetter = (name: string): string => (language === 'en' ? englishProperName(name) : name);
  const firstName = ownName.split(/\s+/u).find((part) => PERSON_FIRST_NAMES.has(part));
  return {
    senderName: inLetter(ownName),
    ...(firstName ? { senderFirstName: inLetter(firstName) } : {}),
  };
}

export function generateVacancyPitch(options: GenerateVacancyPitchOptions): VacancyPitchResponse {
  const { vacancy, tone = 'executive' } = options;
  const language = options.language ?? detectVacancyLanguage(vacancy);
  const copy = copyFor(language);
  const ownName = options.candidateName?.trim();
  const letterName = options.letterName?.trim() || undefined;
  const candidateName =
    letterName ?? (ownName ? (language === 'en' ? englishProperName(ownName) : ownName) : copy.candidateFallback);
  const facts = withTranslatedStatements(options.facts, language === 'en' ? options.translations : undefined);
  const usableFacts = rankPitchFacts(filterUsableFacts(facts), vacancy, options.rankingContext);
  const useRanking = hasRoleAwarePitchRanking(options.rankingContext);
  const usedEvidenceIds = new Set<string>();
  const notices: string[] = [];

  const requirements = matchRequirements(vacancy.requiredSkills ?? [], usableFacts);
  const subject = copy.subject(vacancy.title, candidateName);
  const pitches = assemblePitches({
    copy,
    vacancy,
    candidateName,
    usableFacts,
    tone,
    recipient: options.recipient,
    usedIds: usedEvidenceIds,
    notices,
    useRanking,
    language,
    workplaces: options.workplaces ?? [],
    ...(options.targetCompany ? { targetCompany: true } : {}),
  });

  return {
    vacancyId: vacancy.id,
    emailPitch: { subject: stripHiddenMarkers(subject), body: stripHiddenMarkers(pitches.emailBody) },
    linkedInNote: stripHiddenMarkers(pitches.linkedInNote),
    atsCoverLetter: stripHiddenMarkers(pitches.atsCoverLetter),
    contactMessage: stripHiddenMarkers(pitches.contactMessage),
    usedEvidenceIds: Array.from(usedEvidenceIds),
    usedFacts: buildUsedFacts(usedEvidenceIds, usableFacts),
    coveredRequirements: requirements.matched,
    unconfirmedRequirements: requirements.missing.map(requirementLabel),
    ...letterSender(ownName, language, letterName),
    language,
    notices,
    generatedAt: new Date().toISOString(),
  };
}
