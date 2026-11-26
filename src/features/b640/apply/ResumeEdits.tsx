import { useState } from 'react';
import {
  RESUME_EDIT_TEXT_MAX,
  type ResumeEditDecision,
  type ResumeVacancyEdit,
} from '../../../../shared/resumeVacancyEdits';
import { apiErrorMessage } from '../../coach/apiClient';
import { Icon, useToast } from '../kit';

type Decide = (decision: ResumeEditDecision) => Promise<void>;

interface RowProps {
  readonly edit: ResumeVacancyEdit;
  readonly busy: boolean;
  /** Сохранилось ли решение: форма закрывается только после сохранения. */
  readonly decide: (decision: ResumeEditDecision) => Promise<boolean>;
}

function TextForm({ edit, busy, decide, onClose }: RowProps & { readonly onClose: () => void }) {
  const [text, setText] = useState(edit.text);
  const save = async () => {
    if (await decide({ action: 'text', id: edit.id, text: text.trim() })) onClose();
  };
  return (
    <form
      className="cv-e-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <textarea
        className="ap-letter cv-e-text"
        aria-label="Текст правки"
        rows={3}
        maxLength={RESUME_EDIT_TEXT_MAX}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <span className="cv-e-acts">
        <button className="cv-undo" type="submit" disabled={busy || !text.trim()}>
          Сохранить
        </button>
        <button className="cv-undo" type="button" disabled={busy} onClick={onClose}>
          Отмена
        </button>
      </span>
    </form>
  );
}

function EditRow({ readOnly, ...props }: RowProps & { readonly readOnly: boolean }) {
  const { edit, busy, decide } = props;
  const [editing, setEditing] = useState(false);
  return (
    <li>
      {editing && !readOnly ? (
        <TextForm {...props} onClose={() => setEditing(false)} />
      ) : (
        <span>{edit.cancelled ? <del>{edit.text}</del> : edit.text}</span>
      )}
      <span className="cv-e-why">{edit.why}</span>
      {readOnly || editing ? null : (
        <span className="cv-e-acts">
          {edit.cancelled ? (
            <button
              className="cv-undo"
              type="button"
              disabled={busy}
              onClick={() => void decide({ action: 'restore', id: edit.id })}
            >
              Вернуть
            </button>
          ) : (
            <>
              <button
                className="cv-undo"
                type="button"
                disabled={busy}
                onClick={() => void decide({ action: 'cancel', id: edit.id })}
              >
                Отменить
              </button>
              <button
                className="cv-undo"
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Изменить
              </button>
            </>
          )}
        </span>
      )}
    </li>
  );
}

interface Props {
  readonly edits: readonly ResumeVacancyEdit[];
  /** Резюме одобрено вместе с письмом: правки уже в снимке. */
  readonly readOnly: boolean;
  readonly onDecide: Decide;
}

/** «Что изменено» (макет o03): правки под вакансию и решения кандидата по ним. */
export function ResumeEdits({ edits, readOnly, onDecide }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const decide = async (decision: ResumeEditDecision) => {
    setBusy(true);
    try {
      await onDecide(decision);
      return true;
    } catch (reason) {
      toast.show({ text: apiErrorMessage(reason, 'Правка не сохранилась. Повторите.') });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="cv-edits">
      <summary className="cv-e-sum">
        <Icon name="target" />
        {`Что изменено · ${edits.filter((item) => !item.cancelled).length}`}
        <Icon name="down" />
      </summary>
      <ul className="cv-e-list" aria-label="Правки под вакансию">
        {edits.map((edit) => (
          <EditRow key={edit.id} edit={edit} busy={busy} readOnly={readOnly} decide={decide} />
        ))}
      </ul>
    </details>
  );
}
