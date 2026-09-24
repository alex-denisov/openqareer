import { pluralRu } from '../../../shared/pluralRu';
import {
  ONBOARDING_ROLE_HYPOTHESIS_THRESHOLD,
  type OnboardingRoleCard,
} from './onboardingRoleCards';

interface OnboardingRolesStepProps {
  readonly cards: readonly OnboardingRoleCard[];
  readonly selectedIds: readonly string[];
  readonly onToggle: (id: string) => void;
}

function countBadge(card: OnboardingRoleCard) {
  if (card.vacancyCount === undefined) {
    return <span className="tag tag-warning">Число вакансий уточняется</span>;
  }
  if (card.isHypothesis) {
    return (
      <span className="tag tag-hypothesis">
        гипотеза — ниже порога {ONBOARDING_ROLE_HYPOTHESIS_THRESHOLD}
      </span>
    );
  }
  return (
    <span className="career-onboarding-role-count metric">
      {pluralRu(card.vacancyCount, ['вакансия', 'вакансии', 'вакансий'])}
    </span>
  );
}

/**
 * Step 4, "На какие роли вас купят" (onboarding.html): up to three role
 * cards, each carrying whatever market count is actually known and the
 * profile evidence that supports it. A missing count says so plainly instead
 * of inventing one (server-side counts by role are not wired to this screen
 * yet — mockup-data-gap.md, "Онбординг" §Шаг 4).
 */
export function OnboardingRolesStep(props: OnboardingRolesStepProps) {
  if (props.cards.length === 0) {
    return (
      <p className="career-inline-note">
        Пока не удалось предложить роль — вернитесь на шаг источника и добавьте
        резюме или ответьте на вопросы о последней роли.
      </p>
    );
  }
  return (
    <div className="career-onboarding-role-grid">
      {props.cards.map((card) => {
        const selected = props.selectedIds.includes(card.id);
        return (
          <button
            key={card.id}
            type="button"
            className={`career-onboarding-role-card ${selected ? 'is-selected' : ''}`}
            aria-pressed={selected}
            onClick={() => props.onToggle(card.id)}
          >
            <span className="career-onboarding-role-title">{card.title}</span>
            {countBadge(card)}
            {card.evidenceTags.length > 0 ? (
              <span className="career-onboarding-role-evidence">
                {card.evidenceTags.map((tag) => (
                  <span key={tag} className="tag tag-success">
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
