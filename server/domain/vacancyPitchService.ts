import { stripHiddenMarkers } from '../../shared/textHygiene';
import { isImportedMemoryId } from './resumeImport';
import { rankPitchFacts } from './pitchFactRanking';

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

export interface GenerateVacancyPitchOptions {
  readonly vacancy: VacancyPitchInputVacancy;
  readonly candidateName?: string;
  readonly facts: readonly VacancyPitchInputFact[];
  readonly tone?: PitchTone;
  /** Переопределяет язык, иначе он определяется по тексту вакансии. */
  readonly language?: PitchLanguage;
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
  readonly usedEvidenceIds: readonly string[];
  readonly usedFacts: readonly VacancyPitchUsedFact[];
  readonly language: PitchLanguage;
  /**
   * Состояния «мало фактов» / «требования не сопоставлены» уходят сюда, а не
   * в тело письма: кандидат копирует тело рекрутеру как есть, и служебный
   * текст об отсутствии данных там читать не должен никто, кроме кандидата.
   */
  readonly notices: readonly string[];
  readonly generatedAt: string;
}

const LINKEDIN_NOTE_LIMIT = 300;

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
  const text = `${vacancy.title} ${vacancy.description ?? ''}`;
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
  subject(title: string, candidateName: string, tone: PitchTone, hasMetric: boolean): string;
  intro(title: string, company: string | undefined, tone: PitchTone): string;
  evidenceIntro: string;
  stackEmpty: string;
  stackMatched(skills: string): string;
  stackMissing(skills: string): string;
  closing(tone: PitchTone): string;
  linkedIn(vacancy: VacancyPitchInputVacancy, tone: PitchTone, snippet: string): string;
  ats: {
    to(companyLine: string): string;
    position: string;
    candidate: string;
    greeting(company: string | undefined): string;
    resultsHeading: string;
    fitHeading: string;
    signOff: string;
  };
  companyFallback: string;
  candidateFallback: string;
  noticeNoFacts: string;
  noticeNoStackMatch: string;
}

const RU_COPY: Copy = {
  subject: (title, candidateName, tone, hasMetric) => {
    if (tone === 'technical') return `${title} — ${candidateName} | Технический контекст роли`;
    if (tone === 'confident') {
      return `Отклик на позицию ${title}: ${candidateName} — обсуждение задач роли`;
    }
    const suffix = hasMetric ? 'Подтверждённые результаты' : 'Цели и задачи роли';
    return `${title} — ${candidateName} | ${suffix}`;
  },
  intro: (title, company, tone) => {
    const target = company ? 'компании ' + company : 'вашей команды';
    const opening =
      tone === 'confident'
        ? 'Направляю отклик и буду рад обсудить задачи роли.'
        : tone === 'technical'
          ? 'Буду рад обсудить технический контекст и ожидания команды.'
          : 'Буду рад узнать больше о целях и приоритетах роли.';
    return 'Здравствуйте! Заинтересовала вакансия ' + title + ' в ' + target + '. ' + opening;
  },
  evidenceIntro: 'В профиле зафиксированы следующие факты:',
  stackEmpty: 'Требования вакансии не сопоставлены с фактами профиля.',
  stackMatched: (skills) => `В профиле подтверждён практический опыт работы со стеком: ${skills}`,
  stackMissing: (skills) => `В профиле нет подтверждённых фактов по требованиям: ${skills}`,
  closing: (tone) => {
    if (tone === 'technical') {
      return 'Буду рад ответить на технические вопросы и разобрать архитектурные кейсы на короткой встрече.';
    }
    if (tone === 'confident') {
      return 'Предлагаю созвониться на 15 минут, чтобы предметно обсудить задачи и взаимные ожидания.';
    }
    return 'Буду рад обсудить цели роли и приоритеты бизнеса на коротком звонке.';
  },
  linkedIn: (vacancy, tone, snippet) => {
    const companyPart = vacancy.company ? ` в ${vacancy.company}` : '';
    if (tone === 'technical') {
      return `Здравствуйте! Заинтересовала позиция ${vacancy.title}${companyPart}.${snippet} Буду рад обсудить инженерные вызовы и добавить вас в сеть!`;
    }
    if (tone === 'confident') {
      return `Здравствуйте! Откликаюсь на роль ${vacancy.title}${companyPart}.${snippet} Готов обсудить задачи на коротком звонке, рад знакомству!`;
    }
    return `Здравствуйте! Заинтересовала роль ${vacancy.title}${companyPart}.${snippet} Буду рад обсудить задачи команды и добавить вас в сеть контактов!`;
  },
  ats: {
    to: (companyLine) => `Кому: Нанимающей команде ${companyLine}`,
    position: 'Позиция',
    candidate: 'Кандидат',
    greeting: (company) => `Уважаемая команда${company ? ` ${company}` : ''}!`,
    resultsHeading: 'Ключевые результаты:',
    fitHeading: 'Соответствие требованиям роли:',
    signOff: 'С уважением,',
  },
  companyFallback: 'вашей команды',
  candidateFallback: 'Кандидат',
  noticeNoFacts: 'В профиле пока нет фактов, годных для письма — добавьте их перед отправкой.',
  noticeNoStackMatch: 'Требования вакансии не сопоставлены ни с одним фактом профиля.',
};

const EN_COPY: Copy = {
  subject: (title, candidateName, tone, hasMetric) => {
    if (tone === 'technical') return `${title} — ${candidateName} | Technical context of the role`;
    if (tone === 'confident')
      return `Application for ${title}: ${candidateName} — role scope discussion`;
    const suffix = hasMetric ? 'Proven results' : 'Role goals and scope';
    return `${title} — ${candidateName} | ${suffix}`;
  },
  intro: (title, company, tone) => {
    const target = company ? `the ${company} team` : 'your team';
    const opening =
      tone === 'confident'
        ? "I'm submitting my application and would be glad to discuss the role's scope."
        : tone === 'technical'
          ? "I'd be glad to discuss the technical context and the team's expectations."
          : "I'd be glad to learn more about the role's goals and priorities.";
    return `Hello! I'm interested in the ${title} role at ${target}. ${opening}`;
  },
  evidenceIntro: 'My profile records the following facts:',
  stackEmpty: "The vacancy's requirements have not been matched against profile facts.",
  stackMatched: (skills) => `My profile confirms hands-on experience with: ${skills}`,
  stackMissing: (skills) => `My profile has no confirmed facts for: ${skills}`,
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
    fitHeading: 'Fit against the role requirements:',
    signOff: 'Best regards,',
  },
  companyFallback: 'your team',
  candidateFallback: 'Candidate',
  noticeNoFacts: 'No profile facts are ready for this letter yet — add them before sending.',
  noticeNoStackMatch: "The vacancy's requirements are not matched against any profile fact.",
};

function copyFor(language: PitchLanguage): Copy {
  return language === 'en' ? EN_COPY : RU_COPY;
}

function buildEvidenceParagraph(
  copy: Copy,
  facts: readonly VacancyPitchInputFact[],
  usedIds: Set<string>,
  notices: string[],
): string {
  if (facts.length === 0) {
    // The "too few facts" state is not letter content — it goes to `notices`
    // and the paragraph is simply omitted (B266).
    notices.push(copy.noticeNoFacts);
    return '';
  }
  const metricFact =
    facts.find((f) => f.domain === 'outcome' || /\d+/u.test(f.statement)) ?? facts[0];
  if (metricFact) usedIds.add(metricFact.id);
  const otherFacts = facts.filter((f) => f.id !== metricFact?.id).slice(0, 2);
  for (const f of otherFacts) usedIds.add(f.id);
  const statements = [metricFact?.statement, ...otherFacts.map((f) => f.statement)].filter(
    (s): s is string => Boolean(s),
  );
  return `${copy.evidenceIntro} ${joinSentences(statements)}`;
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

function buildStackParagraph(
  copy: Copy,
  vacancy: VacancyPitchInputVacancy,
  facts: readonly VacancyPitchInputFact[],
  usedIds: Set<string>,
  notices: string[],
): string {
  const reqSkills = vacancy.requiredSkills ?? [];
  // Nothing to match is a state for the notice line, never a sentence the
  // candidate would copy to a recruiter (B266).
  if (reqSkills.length === 0) return '';

  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];

  for (const req of reqSkills) {
    const matchedFact = facts.find((f) => hasPositiveSkillEvidence(f, req));
    if (matchedFact) {
      matchedSkills.push(req);
      usedIds.add(matchedFact.id);
    } else {
      missingSkills.push(req);
    }
  }

  const parts: string[] = [];
  if (matchedSkills.length > 0) {
    parts.push(copy.stackMatched(matchedSkills.join(', ')));
  } else {
    notices.push(copy.noticeNoStackMatch);
  }

  if (missingSkills.length > 0) {
    notices.push(copy.stackMissing(missingSkills.slice(0, 3).join(', ')));
  }

  return parts.length > 0 ? `${parts.join('. ')}.` : '';
}

function buildLinkedInNote(
  copy: Copy,
  vacancy: VacancyPitchInputVacancy,
  facts: readonly VacancyPitchInputFact[],
  tone: PitchTone,
  usedIds: Set<string>,
): string {
  const firstFact =
    facts.find((f) => f.domain === 'outcome' || /\d+/u.test(f.statement)) ?? facts[0];
  let snippet = '';
  if (firstFact) {
    usedIds.add(firstFact.id);
    snippet = ` My experience: ${firstFact.statement}.`;
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
  evidence: string,
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
    ...section(copy.ats.resultsHeading, evidence),
    ...section(copy.ats.fitHeading, stack),
    closing,
    '',
    copy.ats.signOff,
    candidateName,
  ].join('\n');
}

export function generateVacancyPitch(options: GenerateVacancyPitchOptions): VacancyPitchResponse {
  const { vacancy, tone = 'executive' } = options;
  const language = options.language ?? detectVacancyLanguage(vacancy);
  const copy = copyFor(language);
  const candidateName = options.candidateName?.trim() || copy.candidateFallback;
  const usableFacts = rankPitchFacts(filterUsableFacts(options.facts), vacancy);
  const usedEvidenceIds = new Set<string>();
  const notices: string[] = [];

  const metricFact = usableFacts.find((f) => /\d+/u.test(f.statement));
  const subject = copy.subject(vacancy.title, candidateName, tone, Boolean(metricFact));

  const intro = copy.intro(vacancy.title, vacancy.company, tone);
  const evidence = buildEvidenceParagraph(copy, usableFacts, usedEvidenceIds, notices);
  const stack = buildStackParagraph(copy, vacancy, usableFacts, usedEvidenceIds, notices);
  const closing = copy.closing(tone);

  const emailBody = [intro, evidence, stack, closing].filter((p) => p.length > 0).join('\n\n');
  const linkedInNote = buildLinkedInNote(copy, vacancy, usableFacts, tone, usedEvidenceIds);
  const atsCoverLetter = buildAtsCoverLetter(
    copy,
    vacancy,
    candidateName,
    intro,
    evidence,
    stack,
    closing,
  );

  const basisById = new Map(usableFacts.map((fact) => [fact.id, factBasis(fact)] as const));
  const usedFacts: VacancyPitchUsedFact[] = Array.from(usedEvidenceIds).map((id) => ({
    id,
    basis: basisById.get(id) ?? 'imported',
  }));

  return {
    vacancyId: vacancy.id,
    emailPitch: {
      subject: stripHiddenMarkers(subject),
      body: stripHiddenMarkers(emailBody),
    },
    linkedInNote: stripHiddenMarkers(linkedInNote),
    atsCoverLetter: stripHiddenMarkers(atsCoverLetter),
    usedEvidenceIds: Array.from(usedEvidenceIds),
    usedFacts,
    language,
    notices,
    generatedAt: new Date().toISOString(),
  };
}
