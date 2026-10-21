import type { VacancyFitView } from '../../../shared/vacancyFit';

export interface RequirementChips {
  readonly confirmed: readonly string[];
  readonly unconfirmed: readonly string[];
}

/** Chips for «Требования к навыкам» from the fit analysis (B523/B524): a
 *  requirement is confirmed only when a profile fact matched it. */
export function fitRequirementChips(view: VacancyFitView | undefined): RequirementChips | null {
  if (!view || view.requirements.length === 0) return null;
  const matched = new Set(
    (view.result?.assessments ?? [])
      .filter((item) => item.status === 'matched')
      .map((item) => item.requirementId),
  );
  const seen = new Set<string>();
  const confirmed: string[] = [];
  const unconfirmed: string[] = [];
  for (const requirement of view.requirements) {
    const text = requirement.text.trim();
    const key = text.toLocaleLowerCase('ru');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    (matched.has(requirement.id) ? confirmed : unconfirmed).push(text);
  }
  return { confirmed, unconfirmed };
}

const CONFIRMED_SKILL_PREFIX = 'Подтверждённый навык: ';

/** Legacy matcher points → chip names (B446-g4): «Подтверждённый навык: X» → X;
 *  role points («Целевая роль: …») are not skill requirements and stay out. */
export function legacySkillChips(
  matchingPoints: readonly string[],
  missingPoints: readonly string[],
): RequirementChips {
  const confirmed = matchingPoints
    .filter((point) => point.startsWith(CONFIRMED_SKILL_PREFIX))
    .map((point) => point.slice(CONFIRMED_SKILL_PREFIX.length).trim())
    .filter(Boolean);
  return { confirmed, unconfirmed: [...missingPoints] };
}
