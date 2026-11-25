/**
 * B801: LinkedIn пускает публиковать вакансии страницы-сообщества («Medical Billing/RCM Jobs -
 * Pakistan», «Confidential Careers»). В поле работодателя тогда имя сообщества, а сам работодатель не
 * назван. Правила узкие: «Mistral Careers» и «HeyJobs» — настоящие страницы, их имя остаётся.
 */
const COMMUNITY: readonly RegExp[] = [
  /\bjobs\s+[-–—]\s+\p{L}[\p{L} &]*$/iu,
  /^confidential\s+(?:jobs|careers)$/iu,
  /^(?:all\s+)?jobs$|^hiring$/iu,
  /\bjobs(?:\s*-\s*hiring|\s+updates)$/iu,
  /^[^,]+(?:,[^,]+)+\s+jobs$/iu,
];

export function isJobCommunityName(company: string): boolean {
  const name = company.trim();
  return COMMUNITY.some((pattern) => pattern.test(name));
}

/** Имя работодателя; у страницы-сообщества его нет. */
export function employerOrNone(company: string): string {
  return isJobCommunityName(company) ? '' : company;
}
