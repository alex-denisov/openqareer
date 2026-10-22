import { useEffect, useState } from 'react';
import { Check, Compass, X } from '@phosphor-icons/react';
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

function useSkillCheckAvailability(skills: readonly string[]): Availability {
  const [availability, setAvailability] = useState<Availability>({ kind: 'loading' });
  const key = skills.join('\n');
  useEffect(() => {
    let active = true;
    setAvailability({ kind: 'loading' });
    void getCurrentRoleSkillAssessment()
      .then((current) => {
        if (active) setAvailability(skillCheckAvailability(current));
      })
      .catch(() => {
        if (active)
          setAvailability({
            kind: 'unavailable',
            reason: 'Не удалось узнать, доступна ли проверка навыков. Попробуйте позже.',
          });
      });
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
  onChooseRole,
}: {
  readonly onStart: (focus: SkillCheckFocus) => void;
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
      onChooseRole={onChooseRole}
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
  onChooseRole,
  onDecline,
}: {
  readonly offer: VacancyQuizOffer;
  readonly onStart: (focus: SkillCheckFocus) => void;
  readonly onChooseRole?: () => void;
  readonly onDecline: () => void;
}) {
  const skills = offer.skills.slice(0, 2);
  const availability = useSkillCheckAvailability(skills);
  const title = quizOfferTitle(skills);
  return (
    <section
      className="career-expert-proposal"
      aria-label={title}
      aria-busy={availability.kind === 'loading'}
    >
      <p className="career-expert-proposal-title">{title}</p>
      <p>
        {availability.kind === 'unavailable'
          ? availability.reason
          : 'Около 20 минут, результат попадёт в профиль и в эту вакансию.'}
      </p>
      <div className="career-expert-actions">
        {availability.kind !== 'unavailable' ? (
          <button
            type="button"
            className="career-quiet-button career-inline-ok"
            disabled={availability.kind === 'loading'}
            onClick={() =>
              onStart({ vacancyId: offer.vacancyId, roleTitle: offer.roleTitle, skills })
            }
          >
            <Check size={16} aria-hidden="true" />
            Начать
          </button>
        ) : null}
        {availability.kind === 'unavailable' && availability.needsRole && onChooseRole ? (
          <button
            type="button"
            className="career-quiet-button career-inline-ok"
            onClick={onChooseRole}
          >
            <Compass size={16} aria-hidden="true" />
            Выбрать роль
          </button>
        ) : null}
        <button type="button" className="career-quiet-button" onClick={onDecline}>
          <X size={16} aria-hidden="true" />
          Не сейчас
        </button>
      </div>
    </section>
  );
}
