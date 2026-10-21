import { ArrowRight, Check, CheckCircle, Circle, Plus } from '@phosphor-icons/react';
import type { JSX } from 'react';
import type {
  CandidateFootprintAudit,
  CandidateFootprintFinding,
  FootprintChecklistMark,
} from '../../../shared/candidateFootprint';
import {
  buildFootprintChecklist,
  type FootprintChecklistItem,
} from '../../../shared/footprintChecklist';

export type FootprintManualMark = Exclude<FootprintChecklistMark, 'added_to_profile'>;

export interface FootprintSanitationChecklistProps {
  readonly audit: CandidateFootprintAudit | null;
  readonly busyFindingId?: string;
  readonly onOpenFindings: () => void;
  readonly onMarkFinding?: (findingId: string, mark: FootprintManualMark) => void;
  readonly onAddToProfile?: (findingId: string) => void;
  readonly onOpenResumeVersions?: () => void;
}

interface FindingAction {
  readonly label: string;
  readonly run: (findingId: string) => void;
  readonly icon?: 'check' | 'plus';
}

function findingActions(
  item: FootprintChecklistItem,
  props: FootprintSanitationChecklistProps,
): readonly FindingAction[] {
  const mark = props.onMarkFinding;
  if (item.id === 'leaks' && mark) {
    return [{ label: 'Пароль сменён', icon: 'check', run: (id) => mark(id, 'password_changed') }];
  }
  if (item.id === 'old_accounts' && mark) {
    return [
      { label: 'Закрыл', icon: 'check', run: (id) => mark(id, 'account_closed') },
      { label: 'Оставить', run: (id) => mark(id, 'account_kept') },
    ];
  }
  if (item.id === 'artifacts' && props.onAddToProfile) {
    return [{ label: 'Добавить в профиль', icon: 'plus', run: props.onAddToProfile }];
  }
  return [];
}

function PendingFindings({
  item,
  findings,
  props,
}: {
  readonly item: FootprintChecklistItem;
  readonly findings: ReadonlyMap<string, CandidateFootprintFinding>;
  readonly props: FootprintSanitationChecklistProps;
}) {
  const actions = findingActions(item, props);
  if (!actions.length || !item.findingIds.length) return null;
  return (
    <ul className="profile-footprint-checklist-finds">
      {item.findingIds.map((id) => (
        <li key={id}>
          <span>{findings.get(id)?.title}</span>
          <span className="profile-footprint-checklist-buttons">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="career-footprint-secondary-button"
                disabled={props.busyFindingId === id}
                onClick={() => action.run(id)}
              >
                {action.icon === 'check' ? <Check aria-hidden="true" /> : null}
                {action.icon === 'plus' ? <Plus aria-hidden="true" /> : null}
                {action.label}
              </button>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ItemLink({
  item,
  props,
}: {
  readonly item: FootprintChecklistItem;
  readonly props: FootprintSanitationChecklistProps;
}) {
  const target =
    item.id === 'review' && !item.done
      ? { label: 'Разобрать находки', run: props.onOpenFindings }
      : item.id === 'metadata' && props.onOpenResumeVersions
        ? { label: 'Пересобрать PDF', run: props.onOpenResumeVersions }
        : null;
  if (!target) return null;
  return (
    <button
      type="button"
      className="career-footprint-secondary-button profile-footprint-checklist-action"
      onClick={target.run}
    >
      {target.label}
      <ArrowRight aria-hidden="true" />
    </button>
  );
}

/** Макет 2, шаг 4: «Чек-лист санации» — пять пунктов, статус и действие у каждого (B544). */
export function FootprintSanitationChecklist(
  props: FootprintSanitationChecklistProps,
): JSX.Element | null {
  if (!props.audit || props.audit.state !== 'completed') return null;
  const checklist = buildFootprintChecklist(props.audit);
  const findings = new Map(props.audit.findings.map((finding) => [finding.id, finding]));
  return (
    <section className="profile-footprint-checklist" aria-label="Пункты чек-листа санации">
      <div className="profile-footprint-checklist-heading">
        <span className="career-footprint-count">
          <span className="career-numeric">{checklist.done}</span> из {checklist.total} пунктов
        </span>
      </div>
      <ol className="profile-footprint-checklist-list">
        {checklist.items.map((item) => (
          <li
            key={item.id}
            className={`profile-footprint-checklist-item ${item.done ? 'is-done' : 'is-open'}`}
          >
            {item.done ? <CheckCircle aria-hidden="true" /> : <Circle aria-hidden="true" />}
            <div className="profile-footprint-checklist-copy">
              <strong>{item.title}</strong>
              <span>{item.status}</span>
              <PendingFindings item={item} findings={findings} props={props} />
            </div>
            <ItemLink item={item} props={props} />
          </li>
        ))}
      </ol>
    </section>
  );
}
