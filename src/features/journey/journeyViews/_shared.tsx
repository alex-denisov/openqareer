import {
  SealCheck,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import type { CandidateWorkspace } from '../../workspace/workspaceStorage';
import {
  type CareerJourney,
  type CareerJourneyDestination,
} from '../careerJourneyEngine';

export interface JourneyViewProps {
  workspace: CandidateWorkspace;
  journey: CareerJourney;
  onNavigate: (view: CareerJourneyDestination | 'tariffs') => void;
  onOpenExpert: () => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
}

export function SourceCapability({
  title,
  state,
  detail,
}: {
  title: string;
  state: 'available' | 'prepared';
  detail: string;
}) {
  return (
    <article>
      {state === 'available' ? (
        <SealCheck size={21} weight="fill" />
      ) : (
        <WarningCircle size={21} />
      )}
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <small>{state === 'available' ? 'Доступно' : 'Готово к тестированию'}</small>
    </article>
  );
}

export function ViewHeader({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <header className="career-view-heading">
      <div>
        <p className="career-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <button className="career-quiet-button" type="button" onClick={onAction}>
        <Sparkle size={17} weight="fill" />
        {action}
      </button>
    </header>
  );
}

export function RoleState({ state }: { state: CareerJourney['roles'][number]['fitState'] }) {
  return (
    <span className={`career-role-state is-${state}`}>
      {state === 'plausible'
        ? 'Рабочая гипотеза'
        : state === 'adjacent'
          ? 'Смежная'
          : 'Нужны факты'}
    </span>
  );
}
