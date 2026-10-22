import {
  ChatCircleText,
  EnvelopeSimple,
  FileText,
  Info,
  Path,
  UserFocus,
  UsersThree,
} from '@phosphor-icons/react';
import { CareerTooltip } from '../shell/CareerTooltip';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { ConnectionCircleNumber } from './vacancyLetterApi';
import { pathCircleCards, pathSourceNote, type PathCircleCard } from './vacancyPathCircles';
import { useVacancyPathCircles } from './useVacancyPathCircles';

export interface CompanyPathActions {
  /** Circle 1: a draft to a known contact, sent only after approval. */
  readonly onWriteContact?: () => void;
  /** Circle 2 and missing contacts: the company's people and paths. */
  readonly onShowPaths?: () => void;
  /** Circle 3: the cover letter screen. */
  readonly onPrepareLetter?: () => void;
  /** Circle 2 «Попросить представить»: the letter screen on circle 2. */
  readonly onAskIntro?: () => void;
}

type Cluster = MatchedVacancyItem['cluster'];

/** Circle buttons lead into the existing mechanics: outreach draft with
 *  approval, the company's people, the cover letter. */
export function companyPathActions(
  cluster: Cluster,
  handlers: {
    readonly onOpenNetworking?: (cluster: Cluster) => void;
    readonly onOpenCompanyPath?: () => void;
    readonly onOpenLetter?: (cluster: Cluster, circle?: ConnectionCircleNumber) => void;
  },
  fallbackLetter: () => void,
): CompanyPathActions {
  const { onOpenNetworking, onOpenLetter } = handlers;
  return {
    onWriteContact: onOpenNetworking ? () => onOpenNetworking(cluster) : undefined,
    onShowPaths: handlers.onOpenCompanyPath,
    // G5 A4: «Подготовить письмо» — холодный отклик, письмо открывается на круге 3.
    onPrepareLetter: onOpenLetter ? () => onOpenLetter(cluster, 3) : fallbackLetter,
    onAskIntro: onOpenLetter ? () => onOpenLetter(cluster, 2) : fallbackLetter,
  };
}

const ICONS: Record<ConnectionCircleNumber, typeof UserFocus> = {
  1: UserFocus,
  2: UsersThree,
  3: EnvelopeSimple,
};

const ACTION_ICONS: Record<ConnectionCircleNumber, typeof UserFocus> = {
  1: ChatCircleText,
  2: Path,
  3: FileText,
};

export function circleAction(
  card: PathCircleCard,
  actions: CompanyPathActions,
): (() => void) | undefined {
  if (!card.known) return actions.onShowPaths;
  if (card.circle === 1) return actions.onWriteContact;
  if (card.circle === 2) return actions.onShowPaths;
  return actions.onPrepareLetter;
}

function CircleCard({
  card,
  actions,
}: {
  readonly card: PathCircleCard;
  readonly actions: CompanyPathActions;
}) {
  const Icon = ICONS[card.circle];
  const ActionIcon = ACTION_ICONS[card.circle];
  const onClick = circleAction(card, actions);
  return (
    <li className="vacancy-path-circle">
      <span className={`vacancy-path-circle-tag${card.circle === 3 ? ' is-dim' : ''}`}>
        <Icon size={14} aria-hidden="true" />
        {card.label}
      </span>
      <b>{card.title}</b>
      <p>{card.summary}</p>
      {onClick ? (
        <button type="button" className="btn btn-secondary action-btn" onClick={onClick}>
          <ActionIcon size={15} aria-hidden="true" />
          {card.actionLabel}
        </button>
      ) : null}
    </li>
  );
}

function PathPanelStatus({
  state,
  onPrepareLetter,
}: {
  readonly state: ReturnType<typeof useVacancyPathCircles>;
  readonly onPrepareLetter?: () => void;
}) {
  return (
    <>
      {state.status === 'loading' ? (
        <p className="vacancy-path-status" role="status">
          Загружаем связи с компанией…
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className="vacancy-path-status" role="alert">
          <p>Не удалось загрузить связи с компанией.</p>
          <button type="button" className="btn btn-secondary action-btn" onClick={state.retry}>
            Повторить
          </button>
        </div>
      ) : null}
      {state.status !== 'ready' && onPrepareLetter ? (
        // B446-g4: холодное письмо (круг 3) не зависит от контактов — доступно и без кругов.
        <button type="button" className="btn btn-secondary action-btn" onClick={onPrepareLetter}>
          <FileText size={15} aria-hidden="true" />
          Подготовить письмо
        </button>
      ) : null}
    </>
  );
}

export function VacancyCompanyPathPanel({
  id,
  vacancyId,
  actions,
}: {
  readonly id: string;
  readonly vacancyId: string;
  readonly actions: CompanyPathActions;
}) {
  const state = useVacancyPathCircles(vacancyId, true);
  const headingId = `${id}-heading`;
  return (
    <section id={id} className="vacancy-path-panel" aria-labelledby={headingId}>
      <div className="vacancy-path-head">
        <h3 id={headingId}>Как откликнуться: три круга связей</h3>
        {state.status === 'ready' ? (
          <CareerTooltip content={`${pathSourceNote(state.data)} Шанс ответа не показываем.`}>
            <button type="button" className="vacancy-path-info" aria-label="Пояснение">
              <Info size={16} aria-hidden="true" />
            </button>
          </CareerTooltip>
        ) : null}
      </div>
      <PathPanelStatus state={state} onPrepareLetter={actions.onPrepareLetter} />
      {state.status === 'ready' ? (
        <ul className="vacancy-path-circles">
          {pathCircleCards(state.data).map((card) => (
            <CircleCard key={card.circle} card={card} actions={actions} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
