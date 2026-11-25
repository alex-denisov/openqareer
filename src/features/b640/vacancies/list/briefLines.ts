import type { VacancyBrief } from '../../../../../shared/vacancyBrief';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { vacancyFitPercent } from '../../../../../shared/vacancyFitPercent';
import {
  countedSkillRequirements,
  requirementVerdict,
} from '../../../vacancies/vacancyRequirementChips';

const SHOWN = 3;

export interface BriefLine {
  readonly text: string;
  readonly missing: boolean;
}

export interface BriefView {
  readonly duties: readonly string[];
  readonly requirements: readonly BriefLine[];
  /** Только когда разделов нет. */
  readonly opening: string;
}

/** Требования, по которым посчитан процент, сначала те, которых нет в профиле; иначе — из текста. */
function requirementLines(
  brief: VacancyBrief,
  fit: VacancyFitView | undefined,
): readonly BriefLine[] {
  const counted = vacancyFitPercent(fit) === null ? [] : countedSkillRequirements(fit);
  const lines = counted
    .filter((requirement) => requirement.origin !== 'inferred')
    .map((requirement): BriefLine => ({
      text: requirement.text.trim(),
      missing: requirementVerdict(fit, requirement.id).status === 'unmatched',
    }));
  if (lines.length === 0) return brief.requirements.map((text) => ({ text, missing: false }));
  return [...lines.filter((line) => line.missing), ...lines.filter((line) => !line.missing)];
}

export function briefView(brief: VacancyBrief, fit: VacancyFitView | undefined): BriefView {
  const duties = brief.duties.slice(0, SHOWN);
  const requirements = requirementLines(brief, fit).slice(0, SHOWN);
  const named = duties.length > 0 || requirements.length > 0;
  return { duties, requirements, opening: named ? '' : brief.opening };
}
