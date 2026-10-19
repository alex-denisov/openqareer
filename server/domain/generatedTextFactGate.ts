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

export function generatedTextFactNotices(
  language: 'en' | 'ru',
  outputChecks: readonly GeneratedTextFactCheck[],
  modelCheck?: GeneratedTextFactCheck,
): string[] {
  const notices: string[] = [];
  if (modelCheck?.status === 'needs_confirmation') {
    notices.push(language === 'en'
      ? 'The generated letter contains claims that need confirmation. A letter based on your profile facts is shown instead. Review the facts before sending.'
      : 'В сгенерированном письме есть утверждения, которые нужно подтвердить. Вместо него показано письмо на основе фактов профиля. Проверьте факты перед отправкой.');
  }
  const unresolved = outputChecks.flatMap((check) => check.claims)
    .filter((claim) => claim.action === 'ask_candidate');
  for (const claim of unresolved) {
    notices.push(language === 'en'
      ? `Can you confirm this statement from your profile? «${claim.text}»`
      : `Можете подтвердить это утверждение из профиля? «${claim.text}»`);
  }
  return Array.from(new Set(notices));
}

/** Only candidate-owned, non-sensitive source facts can support generated claims. */
export function checkGeneratedTextFacts(
  text: string,
  facts: readonly VacancyPitchInputFact[],
): GeneratedTextFactCheck {
  const eligible = facts.filter((fact) => fact.kind === 'fact' && !fact.sensitive &&
    Boolean(fact.id.trim()) && Boolean(fact.statement.trim()) &&
    (fact.sourceMessageIds?.length ?? 0) > 0);
  const sentences = text.split(/(?<=[.!?])\s+|\n+/u).map((part) => part.trim()).filter(Boolean);
  const claims = sentences.filter((part) => /\d/u.test(part) || OWNERSHIP.test(part) || /проект|project/iu.test(part) || /(?:^|[\s,])(?:я|мой|моя|мои)(?=[\s,])|\b(?:i|my)\b/iu.test(part))
    .map((part) => checkClaim(part, eligible));
  return {
    scope: 'quantities_and_explicit_achievements',
    status: claims.some((claim) => claim.status !== 'confirmed') ? 'needs_confirmation' : 'checked',
    claims,
  };
}
