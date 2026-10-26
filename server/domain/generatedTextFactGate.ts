import type { VacancyPitchInputFact, VacancyPitchResponse } from './vacancyPitchService';

export type GeneratedClaimStatus =
  | 'confirmed'
  | 'partially_confirmed'
  | 'not_in_profile'
  | 'cannot_confirm';

export interface GeneratedClaimCheck {
  readonly text: string;
  readonly status: GeneratedClaimStatus;
  readonly evidenceIds: readonly string[];
  readonly action: 'none' | 'ask_candidate';
}

export interface GeneratedTextFactCheck {
  /** This deterministic gate does not certify arbitrary semantic paraphrases. */
  readonly scope: 'quantities_and_explicit_achievements';
  readonly status: 'checked' | 'needs_confirmation';
  readonly claims: readonly GeneratedClaimCheck[];
}

const OWNERSHIP = /(?:созда[лн]|основа[лт]|возглав|руковод|разработа[лн]|внедр|запуст|увелич|сниз|сократ|добил|постро|удво|утро|автор|реализова[лн]|led|founded|created|built|launched|increased|reduced|achieved|implemented|authored|doubled|managed|delivered|организ|управл)/iu;
const DENIAL = /(?:не могу подтвердить|не подтверждаю|не удалось подтвердить|(?:^|\s)не\s|cannot confirm|can't confirm|unable to confirm|did not|never)/iu;

// Sentences of the letter template itself (vacancyPitchService copy): greetings,
// interest, call proposals, profile intros. They say nothing checkable about the
// candidate, so asking to confirm them buried the real claims (11 notices, 26.10).
const TEMPLATE_SENTENCE = new RegExp([
  String.raw`^(?:(?:hello|hi|dear)\b|здравствуйте|уважаем)`,
  String.raw`^my name is .+, reaching out regarding`,
  String.raw`\b(?:i'?m interested in|applying for|i'?m submitting my application|is a company i want to work for)`,
  String.raw`\b(?:i'?d be glad|happy to discuss|let's set up|great to connect)`,
  String.raw`\bmy profile (?:confirms hands-on experience|has no confirmed facts)`,
  String.raw`requirements have not been matched`,
  String.raw`(?:^|\s)(?:заинтересовал[аи]?|откликаюсь|пишу по поводу|меня зовут)\s`,
  String.raw`(?:^|\s)(?:буду рад|готов обсудить|предлагаю созвониться|рад знакомству)`,
  String.raw`компания, в которой я хочу работать`,
  String.raw`в профиле (?:подтверждён практический опыт|нет подтверждённых фактов)`,
  String.raw`требования вакансии не сопоставлены`,
].join('|'), 'iu');

// Intros glued to the first fact: the fact after them is still checked.
const TEMPLATE_PREFIX = /^(?:my profile records the following facts:|в профиле зафиксированы следующие факты:|коротко о моём опыте:|briefly on my background:|my experience:|мой опыт:)\s*/iu;

function normalized(text: string): string {
  return text.toLocaleLowerCase().replace(/ё/gu, 'е')
    .replace(/(\d),(\d)/gu, '$1.$2')
    .replace(/[^\p{L}\p{N}\p{Sc}%.+−<>=-]+/gu, ' ').replace(/\.(?!\d)/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

function quantities(text: string): string[] {
  // Keep units attached: a budget of 40 million never proves growth of 40%.
  return [...text.toLocaleLowerCase().matchAll(/\d+(?:[.,]\d+)?\s*(?:%|млн|млрд|тыс|million|billion|thousand|лет|года?|years?|months?|месяц\p{L}*|руб\p{L}*|usd|eur|₽|\$|€)?/gu)]
    .map(([value]) => value.replace(/\s+/gu, '').replace(',', '.'));
}

function containsClaim(fact: string, claim: string): boolean {
  // Fail closed on paraphrases: shared numbers alone do not prove causality,
  // personal ownership, units, or the direction of a before/after comparison.
  return normalized(fact) === normalized(claim);
}

function checkClaim(text: string, facts: readonly VacancyPitchInputFact[]): GeneratedClaimCheck {
  const values = quantities(text);
  const exact = facts.filter((fact) => containsClaim(fact.statement, text));
  const denied = facts.filter((fact) => DENIAL.test(fact.statement) &&
    normalized(fact.statement).includes(normalized(text)));
  const confirmed = exact.filter((fact) => !DENIAL.test(fact.statement) &&
    (fact.status === 'confirmed' || fact.status === 'corrected'));
  const partial = facts.filter((fact) => {
    if (DENIAL.test(fact.statement)) return false;
    const sourceValues = quantities(fact.statement);
    return exact.includes(fact) || values.some((value) => sourceValues.includes(value));
  });
  const status: GeneratedClaimStatus = confirmed.length ? 'confirmed'
    : denied.length ? 'cannot_confirm'
      : partial.length ? 'partially_confirmed' : 'not_in_profile';
  const evidence = confirmed.length ? confirmed : denied.length ? denied : partial;
  return {
    text, status, evidenceIds: evidence.map((fact) => fact.id),
    action: status === 'confirmed' ? 'none' : 'ask_candidate',
  };
}

export function checkPitchOutputFacts(
  pitch: VacancyPitchResponse,
  atsCoverLetter: string,
  facts: readonly VacancyPitchInputFact[],
) {
  return {
    emailSubject: checkGeneratedTextFacts(pitch.emailPitch.subject, facts),
    emailBody: checkGeneratedTextFacts(pitch.emailPitch.body, facts),
    linkedInNote: checkGeneratedTextFacts(pitch.linkedInNote, facts),
    contactMessage: checkGeneratedTextFacts(pitch.contactMessage, facts),
    atsCoverLetter: checkGeneratedTextFacts(atsCoverLetter, facts),
  };
}

const SHOWN_CLAIMS = 3;

/** Notices are for the candidate, not the letter: always in Russian, one line
 *  for all unconfirmed claims instead of a question per sentence (26.10). */
export function generatedTextFactNotices(
  _letterLanguage: 'en' | 'ru',
  outputChecks: readonly GeneratedTextFactCheck[],
  modelCheck?: GeneratedTextFactCheck,
): string[] {
  const notices: string[] = [];
  if (modelCheck?.status === 'needs_confirmation') {
    notices.push('В сгенерированном письме есть утверждения, которые нужно подтвердить. Вместо него показано письмо на основе фактов профиля. Проверьте факты перед отправкой.');
  }
  const unresolved = Array.from(new Set(outputChecks.flatMap((check) => check.claims)
    .filter((claim) => claim.action === 'ask_candidate')
    .map((claim) => claim.text.trim())
    .filter(Boolean)));
  if (unresolved.length) {
    const shown = unresolved.slice(0, SHOWN_CLAIMS).map((text) => `«${text}»`).join(', ');
    const rest = unresolved.length - SHOWN_CLAIMS;
    notices.push(`Перед отправкой сверьте с профилем ${unresolved.length} ${claimWord(unresolved.length)}: ${shown}${rest > 0 ? ` и ещё ${rest}` : ''}.`);
  }
  return notices;
}

function claimWord(count: number): string {
  const tens = count % 100;
  const last = count % 10;
  if (tens >= 11 && tens <= 14) return 'утверждений';
  if (last === 1) return 'утверждение';
  if (last >= 2 && last <= 4) return 'утверждения';
  return 'утверждений';
}

/** Only candidate-owned, non-sensitive source facts can support generated claims. */
export function checkGeneratedTextFacts(
  text: string,
  facts: readonly VacancyPitchInputFact[],
): GeneratedTextFactCheck {
  const eligible = facts.filter((fact) => fact.kind === 'fact' && !fact.sensitive &&
    Boolean(fact.id.trim()) && Boolean(fact.statement.trim()) &&
    (fact.sourceMessageIds?.length ?? 0) > 0);
  const sentences = text.split(/(?<=[.!?])\s+|\n+/u)
    .map((part) => part.trim().replace(TEMPLATE_PREFIX, ''))
    .filter((part) => part && !TEMPLATE_SENTENCE.test(part));
  const claims = sentences.filter((part) => /\d/u.test(part) || OWNERSHIP.test(part) || /проект|project/iu.test(part) || /(?:^|[\s,])(?:я|мой|моя|мои)(?=[\s,])|\b(?:i|my)\b/iu.test(part))
    .map((part) => checkClaim(part, eligible));
  return {
    scope: 'quantities_and_explicit_achievements',
    status: claims.some((claim) => claim.status !== 'confirmed') ? 'needs_confirmation' : 'checked',
    claims,
  };
}
