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
  /** Which group is captured, per `intakeSourceLock` — the other groups shut. */
  readonly lockedTo?: OnboardingSourceCardChoice;
  readonly lockReason?: string;
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
  readonly group: OnboardingSourceCardChoice;
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
      group: 'pdf',
      onClick: props.onChoosePdf,
    },
    {
      id: 'linkedin',
      icon: LinkSimple,
      title: 'Профиль LinkedIn',
      detail: 'Импортируем без повторного ввода',
      selected: props.linkedinSelected,
      group: 'profile-import',
      onClick: props.onChooseLinkedin,
    },
    {
      id: 'hh',
      icon: FileText,
      title: 'Резюме на hh.ru',
      detail: 'Свяжем аккаунт и заберём факты',
      selected: props.hhSelected,
      group: 'profile-import',
      onClick: props.onChooseHh,
    },
    {
      id: 'talk',
      icon: ChatCircleText,
      title: 'Расскажу сам',
      detail: 'Нет готового резюме — ответим на 3 вопроса',
      selected: props.active === 'none',
      group: 'none',
      onClick: props.onChooseTalk,
    },
  ];
}

export function OnboardingSourceCards(props: OnboardingSourceCardsProps) {
  const cards = buildCards(props);
  return (
    <div className="career-onboarding-source-grid" role="group" aria-label="Источник опыта">
      {cards.map((card) => {
        const closed = props.lockedTo !== undefined && props.lockedTo !== card.group;
        return (
          <button
            key={card.id}
            type="button"
            className={`career-onboarding-source-card ${card.selected ? 'is-selected' : ''}`}
            aria-pressed={card.selected}
            aria-disabled={closed ? true : undefined}
            data-blocked={closed ? 'true' : undefined}
            title={closed ? props.lockReason : undefined}
            onClick={closed ? undefined : card.onClick}
          >
            <card.icon size={26} weight={card.selected ? 'fill' : 'regular'} />
            <strong>{card.title}</strong>
            <span>{card.detail}</span>
          </button>
        );
      })}
    </div>
  );
}
