import type {
  QuestionnaireQuestion,
  QuestionnaireSuggestion,
} from '../../shared/applicationQuestionnaire';

/**
 * B641: ответы анкеты из того, что точно есть в профиле кандидата. Каждое правило берёт одно
 * поле профиля как есть; чего в профиле нет — того нет и в ответе. Ничего не выводится
 * по смыслу: «Вы вправе работать в Германии?» по гражданству не решается.
 */
export interface QuestionnaireProfileFacts {
  readonly fullName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly linkedinUrl?: string;
  /** Остальные ссылки из контактов: сайт, портфолио, GitHub. */
  readonly links?: readonly string[];
  /** Место жительства одной строкой, как в контактах: «Москва, Россия». */
  readonly location?: string;
  readonly citizenship?: readonly string[];
  /** В условиях поиска отмечена релокация. Не отмечена — ответа нет, а не «нет». */
  readonly openToRelocation?: boolean;
}

const SOURCE_CONTACTS = 'Из контактов вашего профиля';
const SOURCE_SEARCH = 'Из условий поиска в вашем профиле';

interface Rule {
  readonly matches: RegExp;
  /** Вопросы, похожие по словам, но о другом: «название компании», «код страны». */
  readonly except?: RegExp;
  readonly source: string;
  readonly value: (facts: QuestionnaireProfileFacts, question: string) => string | undefined;
}

function clean(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function isLinkedin(link: string): boolean {
  return /linkedin\.com/iu.test(link);
}

function isGithub(link: string): boolean {
  return /github\.com/iu.test(link);
}

/** Город и страна: только когда место записано через запятую — иначе страну не знаем. */
function locationParts(location: string | undefined): { city?: string; country?: string } {
  const parts = (location ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { city: parts[0] };
  return { city: parts[0], country: parts[parts.length - 1] };
}

const RELOCATION = /(willing|open|ready|able|prepared) to relocat|готовы\S* (ли )?(вы )?(к )?(переезд|релокац)|рассматриваете (ли )?(переезд|релокац)/iu;

/** Вопрос о другом человеке или о том, откуда кандидат узнал о вакансии, — не о его контактах. */
const NOT_ABOUT_CANDIDATE = /referee|reference|referr|manager|supervisor|emergency|recruiter|how did you|where did you|рекомендат|руководител|экстренн|(откуда|как) вы узнали/iu;

const RULES: readonly Rule[] = [
  {
    matches: RELOCATION,
    // «Готовы переехать в Берлин?» — про конкретное место, в профиле этого нет.
    except: /relocat\w* to\b|(переезд\S*|переехать|релокаци\S*) в(?!\p{L})/iu,
    source: SOURCE_SEARCH,
    value: (facts, question) => {
      if (!facts.openToRelocation) return undefined;
      return /\p{Script=Cyrillic}/u.test(question) ? 'Да' : 'Yes';
    },
  },
  {
    matches: /linkedin/iu,
    source: SOURCE_CONTACTS,
    value: (facts) => clean(facts.linkedinUrl) ?? facts.links?.find(isLinkedin),
  },
  { matches: /github/iu, source: SOURCE_CONTACTS, value: (facts) => facts.links?.find(isGithub) },
  {
    matches: /web\s?site|portfolio|personal (site|page)|сайт|портфолио/iu,
    except: /our (web)?site|company|наш\S* сайт|сайт\S* компании/iu,
    source: SOURCE_CONTACTS,
    value: (facts) => facts.links?.find((link) => !isLinkedin(link) && !isGithub(link)),
  },
  { matches: /e-?mail|электронн\S* почт|адрес почты/iu, source: SOURCE_CONTACTS, value: (facts) => clean(facts.email) },
  {
    matches: /phone|mobile number|телефон/iu,
    source: SOURCE_CONTACTS,
    value: (facts) => clean(facts.phone),
  },
  {
    matches: /citizenship|nationality|гражданств/iu,
    source: SOURCE_SEARCH,
    value: (facts) => clean(facts.citizenship?.map((item) => item.trim()).filter(Boolean).join(', ')),
  },
  {
    matches: /\bcountry\b|стран[аеу](?!\p{L})/iu,
    except: /country code|код страны|countries/iu,
    source: SOURCE_CONTACTS,
    value: (facts) => locationParts(facts.location).country,
  },
  {
    matches: /\bcity\b|город/iu,
    except: /office|офис|relocat|переезд|переехать/iu,
    source: SOURCE_CONTACTS,
    value: (facts) => locationParts(facts.location).city,
  },
  {
    matches: /where are you (currently )?(based|located)|current location|место ?жительств|где вы (сейчас )?(живёте|живете|находитесь)/iu,
    source: SOURCE_CONTACTS,
    value: (facts) => clean(facts.location),
  },
  {
    matches: /^(your |full |legal )*name\b|полное имя|имя и фамили|фамилия и имя|(?<!\p{L})фио(?!\p{L})/iu,
    except: /company|employer|компани|работодател/iu,
    source: SOURCE_CONTACTS,
    value: (facts) => clean(facts.fullName),
  },
];

/** Значение для вопроса с выбором — только если среди вариантов есть ровно оно. */
function forQuestion(question: QuestionnaireQuestion, value: string): string | undefined {
  if (question.kind === 'text') return value;
  const wanted = value.toLocaleLowerCase();
  return question.options?.find((option) => option.trim().toLocaleLowerCase() === wanted);
}

/** Ответы из профиля: по одному на вопрос, первый подошедший по правилам. */
export function profileAnswers(
  questions: readonly QuestionnaireQuestion[],
  facts: QuestionnaireProfileFacts | null,
): readonly QuestionnaireSuggestion[] {
  if (!facts) return [];
  return questions.flatMap((question) => {
    for (const rule of RULES) {
      if (!rule.matches.test(question.text) || rule.except?.test(question.text)) continue;
      if (NOT_ABOUT_CANDIDATE.test(question.text)) return [];
      const value = rule.value(facts, question.text);
      const text = value ? forQuestion(question, value) : undefined;
      return text ? [{ questionId: question.id, text, source: rule.source }] : [];
    }
    return [];
  });
}
