import type { VacancyFitView } from '../../../shared/vacancyFit';

export interface RequirementChips {
  /** Green: confirmed by a skill check (owner 29.10). */
  readonly confirmed: readonly string[];
  /** Outline: not in the profile. */
  readonly unconfirmed: readonly string[];
  /** Yellow: stated in the profile but not checked; counts half. */
  readonly stated?: readonly string[];
  /** Chip name → full requirement text for the tooltip (B510). */
  readonly quotes?: Readonly<Record<string, string>>;
  /** Conditions (education, language, format, work permit): listed apart, never as skill chips. */
  readonly conditions?: readonly string[];
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

/** Same split as the server's percent (B510-r): experience and skills count, conditions do not. */
export function isSkillRequirement(requirement: Requirement): boolean {
  const kind = requirement.kind as string | undefined;
  return kind === 'experience' || (requirement.skill ?? (kind === undefined || kind === 'other'));
}

/** Requirement id → matched by a skill check (true) or only stated in the profile (false). */
export function matchedRequirements(
  view: VacancyFitView | undefined,
): ReadonlyMap<string, boolean> {
  return new Map(
    (view?.result?.assessments ?? [])
      .filter((item) => item.status === 'matched')
      .map((item) => [item.requirementId, item.checked === true]),
  );
}

/** Chips for «Требования к навыкам» from the fit analysis (owner 29.10): green when a skill
 *  check confirmed it, yellow when the profile states it unchecked, outline when it is missing. */
export function fitRequirementChips(view: VacancyFitView | undefined): RequirementChips | null {
  if (!view || view.requirements.length === 0) return null;
  const matched = matchedRequirements(view);
  const seen = new Set<string>();
  const confirmed: string[] = [];
  const unconfirmed: string[] = [];
  const stated: string[] = [];
  const quotes: Record<string, string> = {};
  const conditions: string[] = [];
  for (const requirement of view.requirements) {
    if (!isSkillRequirement(requirement)) {
      const condition = requirementChipLabel(requirement);
      if (condition && !conditions.includes(condition)) conditions.push(condition);
      continue;
    }
    const label = requirementChipLabel(requirement);
    const key = label?.toLocaleLowerCase('ru');
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    const checked = matched.get(requirement.id);
    (checked === undefined ? unconfirmed : checked ? confirmed : stated).push(label);
    if (requirement.text.trim() !== label) quotes[label] = requirement.text.trim();
  }
  return { confirmed, unconfirmed, stated, quotes, ...(conditions.length ? { conditions } : {}) };
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
