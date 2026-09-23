import {
  ChatCircleText,
  FileText,
  LinkSimple,
  UploadSimple,
  type Icon,
} from '@phosphor-icons/react';

export type OnboardingSourceCardChoice = 'pdf' | 'profile-import' | 'none';

interface OnboardingSourceCardsProps {
  /** The wizard's underlying `SourceChoice`, coarser than these four cards. */
  readonly active: OnboardingSourceCardChoice;
  /** True once this account's LinkedIn profile is the one behind `profile-import`. */
  readonly linkedinSelected: boolean;
  readonly hhSelected: boolean;
  readonly onChoosePdf: () => void;
  readonly onChooseLinkedin: () => void;
  readonly onChooseHh: () => void;
  readonly onChooseTalk: () => void;
}

interface CardConfig {
  readonly id: string;
  readonly icon: Icon;
  readonly title: string;
  readonly detail: string;
  readonly selected: boolean;
  readonly onClick: () => void;
}

/**
 * Step 1, "С чем разбираемся?" (onboarding.html): four explicit sources
 * rather than a generic "импорт профиля" gate. LinkedIn and hh.ru still share
 * `SourceChoice.profile-import` underneath (one connected platform at a
 * time — `intakeSourceLock`), the two cards only tell them apart on screen.
 */
function buildCards(props: OnboardingSourceCardsProps): CardConfig[] {
  return [
    {
      id: 'pdf',
      icon: UploadSimple,
      title: 'PDF резюме',
      detail: 'Разберём факты за 30–60 секунд',
      selected: props.active === 'pdf',
      onClick: props.onChoosePdf,
    },
    {
      id: 'linkedin',
      icon: LinkSimple,
      title: 'Профиль LinkedIn',
      detail: 'Импортируем без повторного ввода',
      selected: props.linkedinSelected,
      onClick: props.onChooseLinkedin,
    },
    {
      id: 'hh',
      icon: FileText,
      title: 'Резюме на hh.ru',
      detail: 'Свяжем аккаунт и заберём факты',
      selected: props.hhSelected,
      onClick: props.onChooseHh,
    },
    {
      id: 'talk',
      icon: ChatCircleText,
      title: 'Расскажу сам',
      detail: 'Нет готового резюме — ответим на 3 вопроса',
      selected: props.active === 'none',
      onClick: props.onChooseTalk,
    },
  ];
}

export function OnboardingSourceCards(props: OnboardingSourceCardsProps) {
  const cards = buildCards(props);
  return (
    <div className="career-onboarding-source-grid" role="group" aria-label="Источник опыта">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className={`career-onboarding-source-card ${card.selected ? 'is-selected' : ''}`}
          aria-pressed={card.selected}
          onClick={card.onClick}
        >
          <card.icon size={26} weight={card.selected ? 'fill' : 'regular'} />
          <strong>{card.title}</strong>
          <span>{card.detail}</span>
        </button>
      ))}
    </div>
  );
}
