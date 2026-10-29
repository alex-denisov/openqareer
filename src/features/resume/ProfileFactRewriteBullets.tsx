import { useId, useState } from 'react';
import { Check, PencilSimple, Trash, X } from '@phosphor-icons/react';
import { bulletKey, type FactRewriteProposal } from '../../../server/domain/experienceFactRewrite';
import type { ResumeDraft } from './resumeTypes';

/** Bullet key → the candidate's text, or `null` for «Убрать». */
export type BulletEdits = Readonly<Record<string, string | null>>;

const MAX_BULLET_LENGTH = 320;

function employerOf(draft: ResumeDraft, experienceId: string): string {
  return (
    draft.experience.find((entry) => entry.id === experienceId)?.employer || 'Компания не указана'
  );
}

/** Whether anything is left to accept once the candidate's removals apply. */
export function hasBulletsLeft(proposal: FactRewriteProposal, edits: BulletEdits): boolean {
  return proposal.places.some((place) =>
    place.bullets.some((_, index) => edits[bulletKey(place.experienceId, index)] !== null),
  );
}

function BulletEditor({
  initial,
  onDone,
  onCancel,
}: {
  readonly initial: string;
  readonly onDone: (text: string) => void;
  readonly onCancel: () => void;
}) {
  const fieldId = useId();
  const [text, setText] = useState(initial);
  const clean = text.trim();
  return (
    <div className="profile-fact-rewrite__editor">
      <label className="career-sr-only" htmlFor={fieldId}>
        Текст пункта
      </label>
      <textarea
        id={fieldId}
        value={text}
        maxLength={MAX_BULLET_LENGTH}
        rows={3}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="profile-fact-rewrite__bullet-actions">
        <button
          type="button"
          className="career-btn is-sm pm-cta is-inline"
          disabled={clean.length < 2}
          onClick={() => onDone(clean)}
        >
          <Check size={16} aria-hidden="true" />
          Готово
        </button>
        <button type="button" className="career-btn is-sm pm-text" onClick={onCancel}>
          <X size={16} aria-hidden="true" />
          Отмена
        </button>
      </div>
    </div>
  );
}

function BulletActions({
  busy,
  onEdit,
  onRemove,
}: {
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <span className="profile-fact-rewrite__bullet-actions">
      <button type="button" className="career-btn is-sm pm-text" disabled={busy} onClick={onEdit}>
        <PencilSimple size={16} aria-hidden="true" />
        Изменить
      </button>
      <button type="button" className="career-btn is-sm pm-text" disabled={busy} onClick={onRemove}>
        <Trash size={16} aria-hidden="true" />
        Убрать
      </button>
    </span>
  );
}

function BulletRow({
  text,
  busy,
  onEdit,
  onRemove,
}: {
  readonly text: string;
  readonly busy: boolean;
  readonly onEdit: (text: string) => void;
  readonly onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li>
        <BulletEditor
          initial={text}
          onDone={(next) => {
            onEdit(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li>
      <span className="career-sr-only">Предлагается: </span>
      <ins>{text}</ins>
      <BulletActions busy={busy} onEdit={() => setEditing(true)} onRemove={onRemove} />
    </li>
  );
}

/**
 * The consultant's bullets by employer. Before «Принять» the candidate can
 * reword or remove any of them (owner, 29.10): «с 4 до 11, добавив 3» is
 * theirs to fix, not a reason to decline the whole block.
 */
export function ProposalBullets({
  draft,
  proposal,
  edits,
  busy,
  onChange,
}: {
  readonly draft: ResumeDraft;
  readonly proposal: FactRewriteProposal;
  readonly edits: BulletEdits;
  readonly busy: boolean;
  readonly onChange: (key: string, text: string | null) => void;
}) {
  const places = proposal.places
    .map((place) => ({
      experienceId: place.experienceId,
      bullets: place.bullets
        .map((bullet, index) => ({ key: bulletKey(place.experienceId, index), bullet }))
        .filter(({ key }) => edits[key] !== null),
    }))
    .filter((place) => place.bullets.length > 0);
  return (
    <div className="profile-experience-suggestions__rows" role="list">
      {places.map((place) => (
        <div
          key={place.experienceId}
          className="pm-sg-r profile-experience-suggestions__row profile-fact-rewrite__place"
          data-experience-id={place.experienceId}
          role="listitem"
        >
          <span className="profile-experience-suggestions__employer">
            {employerOf(draft, place.experienceId)}
          </span>
          <ul className="profile-fact-rewrite__bullets">
            {place.bullets.map(({ key, bullet }) => (
              <BulletRow
                key={key}
                text={edits[key] ?? bullet.text}
                busy={busy}
                onEdit={(text) => onChange(key, text)}
                onRemove={() => onChange(key, null)}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
