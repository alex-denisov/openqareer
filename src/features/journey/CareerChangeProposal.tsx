import { useState, type ReactElement } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { computeProposalKey } from '../../../shared/consultantProposalKey';
import { rejectCoachProposal, type CoachResult } from '../coach/coachApi';
import type { CareerChangeView } from '../coach/careerChangeView';
import { applyCareerChange, describeCareerChange, type CareerChangeKind } from './careerChangeApply';

const TITLES: Readonly<Record<CareerChangeKind, string>> = {
  'career.role.add': 'Добавить роль в «Карьеру»',
  'career.role.remove': 'Убрать роль из «Карьеры»',
  'career.conditions.update': 'Изменить условия поиска',
};

type Proposal = CoachResult['actionProposals'][number];
type Phase = 'proposed' | 'applying' | 'applied' | 'dismissed';

function useCareerChange(kind: CareerChangeKind, change: CareerChangeView, lines: string[]) {
  const [phase, setPhase] = useState<Phase>('proposed');
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    setPhase('applying');
    setError(null);
    applyCareerChange(kind, change)
      .then(() => setPhase('applied'))
      .catch((reason: unknown) => {
        setPhase('proposed');
        setError(reason instanceof Error ? reason.message : 'Не сохранилось. Попробуйте ещё раз.');
      });
  };
  const dismiss = () => {
    setPhase('dismissed');
    void rejectCoachProposal({
      proposalKey: computeProposalKey(kind, lines.join('; ')),
      reason: 'Кандидат отложил изменение «Карьеры»',
    }).catch(() => undefined);
  };
  return { phase, error, apply, dismiss };
}

function ChangeActions({
  applying,
  onApply,
  onDismiss,
}: {
  readonly applying: boolean;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <div className="career-expert-actions">
      <button
        type="button"
        className="career-quiet-button career-inline-ok"
        disabled={applying}
        onClick={onApply}
      >
        <Check size={16} aria-hidden="true" />
        {applying ? 'Применяем…' : 'Применить'}
      </button>
      <button type="button" className="career-quiet-button" disabled={applying} onClick={onDismiss}>
        <X size={16} aria-hidden="true" />
        Не сейчас
      </button>
    </div>
  );
}

function ChangeCard({
  proposal,
  kind,
  change,
}: {
  readonly proposal: Proposal;
  readonly kind: CareerChangeKind;
  readonly change: CareerChangeView;
}): ReactElement | null {
  const lines = describeCareerChange(kind, change);
  const { phase, error, apply, dismiss } = useCareerChange(kind, change, lines);
  if (phase === 'dismissed') return null;
  return (
    <section className="career-expert-proposal" aria-label={TITLES[kind]} data-testid="career-change-proposal">
      <p className="career-expert-proposal-title">{TITLES[kind]}</p>
      <ul className="career-change-lines">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>{proposal.objective}</p>
      {error ? (
        <p className="career-expert-proposal-error" role="alert">
          {error}
        </p>
      ) : null}
      {phase === 'applied' ? (
        <p role="status">Применено. Подборка «Вакансий» пересчитывается по новым данным.</p>
      ) : (
        <ChangeActions applying={phase === 'applying'} onApply={apply} onDismiss={dismiss} />
      )}
    </section>
  );
}

/**
 * Предложение консультанта изменить «Карьеру» (замечание владельца 26.10):
 * ничего не меняется до «Применить»; после него роли и подборка «Вакансий»
 * пересчитываются по новым ролям и условиям.
 */
export function CareerChangeProposal({
  proposal,
  kind,
}: {
  readonly proposal: Proposal;
  readonly kind: CareerChangeKind;
}): ReactElement | null {
  if (!proposal.careerChange) return null;
  return <ChangeCard proposal={proposal} kind={kind} change={proposal.careerChange} />;
}
