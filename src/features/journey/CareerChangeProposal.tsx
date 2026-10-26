import { useState, type ReactElement } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { careerRoleId } from '../../../shared/roleProposals';
import { useCareerRoles, type CareerRolesState } from '../career-map/careerRoleStore';
import type { CoachResult } from '../coach/coachApi';
import { careerChangeKey, dismissCareerChange, useCareerChangeDismissed } from './careerChangeDismissals';
import type { CareerChangeView } from '../coach/careerChangeView';
import { applyCareerChange, describeCareerChange, type CareerChangeKind } from './careerChangeApply';

const TITLES: Readonly<Record<CareerChangeKind, string>> = {
  'career.role.add': 'Добавить роль в «Карьеру»',
  'career.role.remove': 'Убрать роль из «Карьеры»',
  'career.conditions.update': 'Изменить условия поиска',
};

type Proposal = CoachResult['actionProposals'][number];
type Phase = 'proposed' | 'applying' | 'applied' | 'dismissed';

/**
 * Изменение роли, которое уже стоит на «Карьере», не предлагается заново:
 * после перезагрузки прошлый ответ консультанта иначе снова звал «Применить».
 */
export function roleChangeAlreadyApplied(
  kind: CareerChangeKind,
  change: CareerChangeView,
  roles: Pick<CareerRolesState, 'status' | 'roles' | 'rejected'>,
): boolean {
  if (kind === 'career.conditions.update' || !change.roleTitle || roles.status !== 'ready') return false;
  const id = careerRoleId(change.roleTitle);
  const rejected = roles.rejected.includes(id);
  if (kind === 'career.role.remove') return rejected;
  return !rejected && roles.roles.some((role) => role.id === id);
}

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
    dismissCareerChange(careerChangeKey(kind, lines)).catch(() => {
      setPhase('proposed');
      setError('«Не сейчас» не сохранилось. Попробуйте ещё раз.');
    });
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
  const { phase: ownPhase, error, apply, dismiss } = useCareerChange(kind, change, lines);
  const roles = useCareerRoles(false);
  const dismissedBefore = useCareerChangeDismissed(careerChangeKey(kind, lines));
  const phase =
    ownPhase === 'proposed' && roleChangeAlreadyApplied(kind, change, roles) ? 'applied' : ownPhase;
  if (phase === 'dismissed' || (dismissedBefore && ownPhase === 'proposed')) return null;
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
