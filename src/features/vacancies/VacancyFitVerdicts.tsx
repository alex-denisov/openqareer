import type { VacancyFitView } from '../../../shared/vacancyFit';
import {
  countedSkillRequirements,
  requirementChipLabel,
  requirementVerdict,
} from './vacancyRequirementChips';

const VERDICT = {
  matched: 'есть в профиле',
  partial: 'частично',
  // 04.11: `unmatched` needs a fact that contradicts; `unknown` means nothing shows it either way.
  unmatched: 'расходится с профилем',
  unknown: 'неизвестно',
} as const;

/**
 * 02.11: every counted requirement with its verdict and the profile words it rests on, so the
 * candidate can check a 100 % themselves instead of trusting the number. B631: folded by default —
 * ten quotes pushed «Откликнуться» ~60 scroll steps down the card.
 */
export function VacancyFitVerdicts({ view }: { readonly view?: VacancyFitView }) {
  const rows = countedSkillRequirements(view);
  if (!view?.result || rows.length === 0) return null;
  return (
    <details className="vacancy-fit-verdicts">
      <summary>На чём основан процент</summary>
      <ul>
        {rows.map((requirement) => {
          const { status, checked, impliedRole, evidence } = requirementVerdict(
            view,
            requirement.id,
          );
          return (
            <li key={requirement.id} className={`is-${status}`}>
              <span className="vacancy-fit-verdict-name">
                {requirementChipLabel(requirement) ?? requirement.text}
              </span>
              <span className="vacancy-fit-verdict-status">
                {VERDICT[status]}
                {checked ? ', проверено квизом' : ''}
                {impliedRole ? `, следует из опыта: ${impliedRole}` : ''}
              </span>
              {evidence.map((fact) => (
                <q key={`${fact.factId}:${fact.quote}`}>{fact.quote}</q>
              ))}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
