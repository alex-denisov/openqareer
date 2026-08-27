import {
  ArrowRight,
  Compass,
  FileText,
  Path,
  Sparkle,
  UserCircle,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { AccountSnapshot, CandidateSnapshot } from '../coach/coachApi';
import type { ResumeStudioView } from '../resume/resumeTypes';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import type { CareerCabinetView } from './cabinetViews';
import { pluralRu } from '../../../shared/pluralRu';

/**
 * «Сегодня» answers one question — *what do I do now* — and nothing else.
 *
 * It used to stack the strategist dialogue, the whole profile surface and the
 * market panel, which made it a copy of «Профиль» plus a copy of the «Эксперт»
 * drawer, so the menu stopped meaning anything (B148 §9). Each other section
 * now owns its own subject; this screen only recommends, explains why, and
 * points at the section where the work happens.
 */
interface CareerTodayBriefingProps {
  readonly name: string;
  readonly journey?: CareerJourney;
  readonly snapshot?: CandidateSnapshot;
  readonly resume?: ResumeStudioView;
  readonly account?: AccountSnapshot;
  readonly workspace?: CandidateWorkspace;
  readonly loading: boolean;
  readonly onNavigate: (view: CareerCabinetView) => void;
  readonly onOpenExpert: () => void;
}

export function CareerTodayBriefing(props: CareerTodayBriefingProps) {
  const { journey, snapshot, resume } = props;
  return (
    <div className="career-today">
      <NextActionCard {...props} />
      <LoopStateGrid
        journey={journey}
        snapshot={snapshot}
        resume={resume}
        onNavigate={props.onNavigate}
      />
      <AttentionList journey={journey} snapshot={snapshot} onNavigate={props.onNavigate} />
    </div>
  );
}

function NextActionCard({
  name,
  journey,
  loading,
  onNavigate,
  onOpenExpert,
}: CareerTodayBriefingProps) {
  const action = journey?.nextAction;
  return (
    <section className="career-today-action" aria-labelledby="career-today-action-title">
      <span className="career-cabinet-kicker">Следующий шаг</span>
      <h2 id="career-today-action-title">
        {action?.headline ??
          (loading
            ? 'Собираем карьерную картину…'
            : `${firstName(name)}, начнём с одного подтверждённого результата`)}
      </h2>
      <p>
        {action?.reason ??
          'Пока в профиле нет подтверждённых фактов, любая рекомендация была бы догадкой.'}
      </p>
      {action?.expectedChange ? (
        <p className="career-today-expected">
          <Sparkle size={16} weight="fill" />
          {action.expectedChange}
        </p>
      ) : null}
      <div className="career-today-action-buttons">
        <button
          className="career-primary-button"
          type="button"
          onClick={() => onNavigate(destinationView(action?.destination))}
        >
          {action?.label ?? 'Открыть профиль'}
          <ArrowRight size={17} weight="bold" />
        </button>
        <button className="career-quiet-button" type="button" onClick={onOpenExpert}>
          Обсудить со стратегом
        </button>
      </div>
    </section>
  );
}

interface LoopTile {
  readonly view: CareerCabinetView;
  readonly label: string;
  readonly icon: Icon;
  readonly value: string;
  readonly detail: string;
}

// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
function LoopStateGrid({
  journey,
  snapshot,
  resume,
  onNavigate,
}: {
  journey?: CareerJourney;
  snapshot?: CandidateSnapshot;
  resume?: ResumeStudioView;
  onNavigate: (view: CareerCabinetView) => void;
}) {
  const confirmed = snapshot?.dossier.confirmedCount ?? 0;
  const proposed = snapshot?.dossier.proposedCount ?? 0;
  const resumeRoles = resume?.projection.master.experience.length ?? 0;
  const resumeGaps = resume?.projection.master.unknowns.filter((item) => item.blocking).length ?? 0;
  const roles = journey?.roles.length ?? 0;
  const subscriptions = snapshot?.vacancySubscriptions.length ?? 0;
  const tiles: LoopTile[] = [
    {
      view: 'profile',
      label: 'Профиль',
      icon: UserCircle,
      value: String(confirmed),
      detail: confirmed === 0 ? 'нет подтверждённых фактов' : 'подтверждённых фактов',
    },
    {
      view: 'resume',
      label: 'Резюме',
      icon: FileText,
      value: String(resumeRoles),
      detail:
        resumeRoles === 0
          ? 'резюме ещё не собрано'
          : resumeGaps > 0
            ? `ролей в документе · ${pluralRu(resumeGaps, ['пробел', 'пробела', 'пробелов'])}`
            : 'ролей в документе',
    },
    {
      view: 'career',
      label: 'Карьера',
      icon: Path,
      value: String(roles),
      detail: roles === 0 ? 'гипотез ролей пока нет' : 'рабочих гипотез ролей',
    },
    {
      view: 'opportunities',
      label: 'Возможности',
      icon: Compass,
      value: String(subscriptions),
      detail: subscriptions === 0 ? 'регулярный поиск не настроен' : 'регулярных выборок',
    },
  ];
  return (
    <section className="career-today-loop" aria-label="Состояние карьерного цикла">
      {tiles.map((tile) => {
        const TileIcon = tile.icon;
        return (
          <button key={tile.view} type="button" onClick={() => onNavigate(tile.view)}>
            <TileIcon size={20} />
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
            <small>{tile.detail}</small>
          </button>
        );
      })}
      {reviewQueueNote(proposed) ? (
        <p className="career-today-loop-note">{reviewQueueNote(proposed)}</p>
      ) : null}
    </section>
  );
}

function AttentionList({
  journey,
  snapshot,
  onNavigate,
}: {
  journey?: CareerJourney;
  snapshot?: CandidateSnapshot;
  onNavigate: (view: CareerCabinetView) => void;
}) {
  const unknowns = journey?.profile.importantUnknowns ?? [];
  const unresolved = snapshot?.dossier.readiness.unresolvedQuestions ?? 0;
  if (unknowns.length === 0 && unresolved === 0) return null;
  return (
    <section className="career-today-attention" aria-labelledby="career-today-attention-title">
      <header>
        <WarningCircle size={20} weight="fill" />
        <h3 id="career-today-attention-title">Что мешает точной рекомендации</h3>
      </header>
      <ul>
        {unknowns.slice(0, 4).map((item) => (
          <li key={item}>{item}</li>
        ))}
        {unresolved > 0 ? (
          <li>{unresolved} открытых вопрос(ов) в досье остаются без ответа.</li>
        ) : null}
      </ul>
      <button className="career-quiet-button" type="button" onClick={() => onNavigate('profile')}>
        Заполнить пробелы
        <ArrowRight size={16} />
      </button>
    </section>
  );
}

function destinationView(
  destination?: CareerJourney['nextAction']['destination'],
): CareerCabinetView {
  return destination && destination !== 'today' ? destination : 'profile';
}

/** Facts wait for the candidate, so the sentence has to count them in Russian. */
export function reviewQueueNote(proposed: number): string | undefined {
  if (proposed <= 0) return undefined;
  const counted = pluralRu(proposed, ['факт ждёт', 'факта ждут', 'фактов ждут']);
  return `${counted} вашей проверки в разделе «Профиль».`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] || name;
}
