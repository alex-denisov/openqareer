import type { VacancyFitView } from '../../../shared/vacancyFit';

export interface RequirementChips {
  readonly confirmed: readonly string[];
  readonly unconfirmed: readonly string[];
  /** Chip name → full requirement text for the tooltip (B510). */
  readonly quotes?: Readonly<Record<string, string>>;
}

type Requirement = VacancyFitView['requirements'][number];

/**
 * The chip name of a requirement (B510). The server labels every requirement it serves; a
 * requirement without the field (an older cache) keeps its text only when it is already short.
 * A sentence never becomes a chip.
 */
export function requirementChipLabel(requirement: Requirement): string | undefined {
  if (requirement.skill !== undefined || requirement.label !== undefined) {
    return requirement.label?.trim() || undefined;
  }
  const text = requirement.text.trim();
  return text && text.length <= 40 && text.split(/\s+/u).length <= 5 ? text : undefined;
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
  const quotes: Record<string, string> = {};
  for (const requirement of view.requirements) {
    const label = requirementChipLabel(requirement);
    const key = label?.toLocaleLowerCase('ru');
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    (matched.has(requirement.id) ? confirmed : unconfirmed).push(label);
    if (requirement.text.trim() !== label) quotes[label] = requirement.text.trim();
  }
  return { confirmed, unconfirmed, quotes };
}

const CONFIRMED_SKILL_PREFIX = 'Подтверждённый навык: ';
const ROLE_POINT_PREFIXES = ['Целевая роль:', 'Частичное совпадение по роли:'];

/** A sentence («Функция роли и уровень совпадают по разбору названия.») is never a chip (G5 W2). */
function isChipText(text: string): boolean {
  const clean = text.trim();
  return (
    Boolean(clean) &&
    !/[.!?]$/u.test(clean) &&
    clean.length <= 40 &&
    clean.split(/\s+/u).length <= 5
  );
}

/** Legacy matcher points → chip names (B446-g4): «Подтверждённый навык: X» → X;
 *  role points («Целевая роль: …») are not skill requirements and stay out. */
export function legacySkillChips(
  matchingPoints: readonly string[],
  missingPoints: readonly string[],
): RequirementChips {
  const confirmed = matchingPoints
    .filter((point) => !ROLE_POINT_PREFIXES.some((prefix) => point.startsWith(prefix)))
    .map((point) =>
      point.startsWith(CONFIRMED_SKILL_PREFIX)
        ? point.slice(CONFIRMED_SKILL_PREFIX.length).trim()
        : point.trim(),
    )
    .filter(isChipText);
  return { confirmed, unconfirmed: missingPoints.filter(isChipText) };
}
