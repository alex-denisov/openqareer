import type { VacancyFitView } from '../../../shared/vacancyFit';
import { isSkillRequirement, requirementChipLabel } from './vacancyRequirementChips';

const VERDICT = {
  matched: 'есть в профиле',
  partial: 'частично',
  unmatched: 'нет в профиле',
  unknown: 'нет в профиле',
} as const;

/**
 * 02.11: every counted requirement with its verdict and the profile words it rests on, so the
 * candidate can check a 100 % themselves instead of trusting the number.
 */
export function VacancyFitVerdicts({ view }: { readonly view?: VacancyFitView }) {
  const assessments = view?.result?.assessments ?? [];
  const rows = (view?.requirements ?? []).filter(isSkillRequirement).map((requirement) => ({
    requirement,
    assessment: assessments.find((item) => item.requirementId === requirement.id),
  }));
  if (!view?.result || rows.length === 0) return null;
  return (
    <section className="vacancy-fit-verdicts" aria-label="На чём основан процент">
      <h4>На чём основан процент</h4>
      <ul>
        {rows.map(({ requirement, assessment }) => {
          const impliedRole = view.result?.implied?.find((item) => item.requirementId === requirement.id)?.role;
          const status = impliedRole ? 'matched' : assessment?.status ?? 'unknown';
          return (
            <li key={requirement.id} className={`is-${status}`}>
              <span className="vacancy-fit-verdict-name">
                {requirementChipLabel(requirement) ?? requirement.text}
              </span>
              <span className="vacancy-fit-verdict-status">
                {VERDICT[status]}
                {assessment?.checked ? ', проверено квизом' : ''}
                {impliedRole ? `, следует из опыта: ${impliedRole}` : ''}
              </span>
              {assessment?.evidence.map((fact) => (
                <q key={`${fact.factId}:${fact.quote}`}>{fact.quote}</q>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
