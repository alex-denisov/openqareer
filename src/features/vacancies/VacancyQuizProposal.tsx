import { useEffect, useState } from 'react';
import { Check, X } from '@phosphor-icons/react';
import {
  getCurrentRoleSkillAssessment,
  type RoleSkillAssessmentCurrent,
} from '../skills/roleSkillAssessmentApi';
import {
  dismissQuizOffer,
  isQuizOfferDismissed,
  quizOfferTitle,
  useVacancyQuizOffer,
  type VacancyQuizOffer,
} from './vacancyQuizOffer';

/** What «Начать» hands to the skill check: the skills and the vacancy they came from. */
export interface SkillCheckFocus {
  readonly vacancyId: string;
  readonly roleTitle: string;
  readonly skills: readonly string[];
}

type Availability =
  | { readonly kind: 'loading' }
  | { readonly kind: 'available' }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly needsRole?: boolean };

/** An honest reason instead of «Начать» when the skill check cannot cover these skills. */
export function skillCheckAvailability(current: RoleSkillAssessmentCurrent): Availability {
  // A role check that is ready or running can take the vacancy's skills; whether each skill
  // has enough data is answered honestly on start (B552).
  switch (current.state) {
    // The check needs a role chosen in «Карьера»; roles of the vacancy search do not count (B510).
    case 'role_not_selected':
      return {
        kind: 'unavailable',
        reason:
          'Проверка навыков строится по целевой роли из раздела «Карьера», а там она ещё не выбрана.',
        needsRole: true,
      };
    case 'source_unavailable':
      return {
        kind: 'unavailable',
        reason: 'Источник вакансий сейчас недоступен, проверку навыков не собрать.',
      };
    case 'too_few_vacancies':
      return {
        kind: 'unavailable',
        reason: `Для роли «${current.roleTitle}» мало вакансий: ${current.sampleSize} из ${current.threshold}, проверку навыков пока не собрать.`,
      };
    case 'insufficient_requirements':
      return {
        kind: 'unavailable',
        reason: `В вакансиях роли «${current.roleTitle}» мало требований, проверку навыков пока не собрать.`,
      };
    default:
      return { kind: 'available' };
  }
}

/** The last answer survives remounts, so reopening a vacancy shows the same card at once
 *  instead of «Начать» (disabled) flipping to «Выбрать роль» (G5 W3). */
let lastAvailability: Availability | undefined;

export function resetSkillCheckAvailabilityCache(): void {
  lastAvailability = undefined;
}

function sameAvailability(left: Availability, right: Availability): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function useSkillCheckAvailability(skills: readonly string[]): Availability {
  const [availability, setAvailability] = useState<Availability>(
    () => lastAvailability ?? { kind: 'loading' },
  );
  const key = skills.join('\n');
  useEffect(() => {
    let active = true;
    const settle = (next: Availability) => {
      lastAvailability = next;
      if (active)
        setAvailability((previous) => (sameAvailability(previous, next) ? previous : next));
    };
    void getCurrentRoleSkillAssessment()
      .then((current) => settle(skillCheckAvailability(current)))
      .catch(() =>
        settle({
          kind: 'unavailable',
          reason: 'Не удалось узнать, доступна ли проверка навыков. Попробуйте позже.',
        }),
      );
    return () => {
      active = false;
    };
  }, [key]);
  return availability;
}

/**
 * «Пройти квиз по Kafka и Kubernetes» (4-vakansii.html): the consultant offers the existing
 * skill check for the expanded vacancy's unconfirmed requirements; the result lands in the
 * profile and the vacancy's fit is recalculated.
 */
export function VacancyQuizProposal({
  onStart,
}: {
  readonly onStart: (focus: SkillCheckFocus) => void;
  /** Kept for callers; an unavailable check now hides the card instead (G5 R1). */
  readonly onChooseRole?: () => void;
}) {
  const offer = useVacancyQuizOffer();
  const [declined, setDeclined] = useState(0);
  if (!offer || isQuizOfferDismissed(offer.vacancyId, offer.skills)) return null;
  return (
    <VacancyQuizProposalCard
      key={`${offer.vacancyId}:${declined}`}
      offer={offer}
      onStart={onStart}
      onDecline={() => {
        dismissQuizOffer(offer.vacancyId, offer.skills);
        setDeclined((count) => count + 1);
      }}
    />
  );
}

function VacancyQuizProposalCard({
  offer,
  onStart,
  onDecline,
}: {
  readonly offer: VacancyQuizOffer;
  readonly onStart: (focus: SkillCheckFocus) => void;
  readonly onDecline: () => void;
}) {
  const skills = offer.skills.slice(0, 2);
  const availability = useSkillCheckAvailability(skills);
  const title = quizOfferTitle(skills);
  // G5 R1: the card offers only a check that can start; a title offering a quiz above a text
  // refusing it was a contradiction, so an unavailable (or not yet known) check shows nothing.
  if (availability.kind !== 'available') return null;
  return (
    <section className="career-expert-proposal" aria-label={title}>
      <p className="career-expert-proposal-title">{title}</p>
      <p>Около 15 минут, результат попадёт в профиль и в эту вакансию.</p>
      <div className="career-expert-actions">
        <button
          type="button"
          className="career-quiet-button career-inline-ok"
          onClick={() =>
            onStart({ vacancyId: offer.vacancyId, roleTitle: offer.roleTitle, skills })
          }
        >
          <Check size={16} aria-hidden="true" />
          Начать
        </button>
        <button type="button" className="career-quiet-button" onClick={onDecline}>
          <X size={16} aria-hidden="true" />
          Не сейчас
        </button>
      </div>
    </section>
  );
}
