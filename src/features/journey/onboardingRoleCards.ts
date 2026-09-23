import type { ParsedResumeExperience } from '../workspace/resumeParserTypes';

/**
 * Mirrors `ROLE_HYPOTHESIS_THRESHOLD` in `server/vacancies/campaign.ts`: a
 * role with fewer vacancies than this is a hypothesis, not a result. The
 * count itself is not wired to HTTP yet for the onboarding step (see
 * `mockup-data-gap.md`, "Онбординг" §Шаг 4) — the frontend only carries the
 * same threshold value, ready for the day the count exists client-side.
 */
export const ONBOARDING_ROLE_HYPOTHESIS_THRESHOLD = 8;

export interface OnboardingRoleCard {
  readonly id: string;
  readonly title: string;
  /** `undefined` until a live campaign count reaches the wizard. */
  readonly vacancyCount?: number;
  /** `undefined` alongside `vacancyCount` — no count, no honest verdict. */
  readonly isHypothesis?: boolean;
  readonly evidenceTags: readonly string[];
}

function evidenceFor(role: string, experience: readonly ParsedResumeExperience[]): string[] {
  const job = experience.find(
    (item) => item.title.trim().toLocaleLowerCase('ru') === role.trim().toLocaleLowerCase('ru'),
  );
  if (!job) return [];
  return [...job.achievements, ...job.responsibilities].slice(0, 2);
}

/**
 * "На какие роли вас купят" (onboarding.html step 4): the stated target role
 * leads, followed by up to two distinct recent job titles — a role never
 * appears twice under different casing.
 */
export function buildOnboardingRoleCards(input: {
  readonly targetRole?: string;
  readonly experience: readonly ParsedResumeExperience[];
  readonly vacancyCountsByRole?: Readonly<Record<string, number>>;
}): OnboardingRoleCard[] {
  const target = input.targetRole?.trim();
  if (!target) return [];

  const seen = new Set([target.toLocaleLowerCase('ru')]);
  const titles = [target];
  for (const job of input.experience) {
    const title = job.title.trim();
    const key = title.toLocaleLowerCase('ru');
    if (!title || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length === 3) break;
  }

  return titles.map((title, index) => {
    const vacancyCount = input.vacancyCountsByRole?.[title];
    return {
      id: `role-${index}`,
      title,
      vacancyCount,
      isHypothesis:
        vacancyCount === undefined ? undefined : vacancyCount < ONBOARDING_ROLE_HYPOTHESIS_THRESHOLD,
      evidenceTags: evidenceFor(title, input.experience),
    };
  });
}
