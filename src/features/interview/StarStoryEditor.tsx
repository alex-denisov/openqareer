import { useState, type FormEvent } from 'react';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import {
  STAR_FIELDS,
  starResultHasNumbers,
  starStoryEvidenceStatus,
  type StarField,
  type StarStoryFactView,
  type StarStoryView,
  type StarStoryWriteInput,
} from '../../../shared/starStories';

const FIELD_LABELS: Readonly<Record<StarField, string>> = {
  situation: 'Ситуация',
  task: 'Задача',
  action: 'Действие',
  result: 'Результат',
};

const EMPTY_FIELDS = { situation: '', task: '', action: '', result: '' };

export function StarStoryEditor({
  story,
  facts,
  saving,
  error,
  onCancel,
  onSave,
}: {
  readonly story?: StarStoryView;
  readonly facts: readonly StarStoryFactView[];
  readonly saving: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onSave: (input: StarStoryWriteInput) => Promise<boolean>;
}) {
  const draft = useStarStoryDraft(story, facts, onSave, saving);
  return (
    <form className="career-star-story-editor" onSubmit={draft.submit}>
      <StarStoryEditorError error={error} />
      <StarStoryFieldsForm
        title={draft.title}
        fields={draft.fields}
        onTitle={draft.setTitle}
        onField={draft.setField}
      />
      <StarStoryFactPicker
        facts={facts}
        sourceFactIds={draft.sourceFactIds}
        onChange={draft.setSourceFactIds}
      />
      <StarStoryEvidenceNote
        confidence={draft.confidence}
        resultNeedsSource={draft.resultNeedsSource}
      />
      <StarStoryEditorActions saving={saving} canSave={draft.canSave} onCancel={onCancel} />
    </form>
  );
}

function useStarStoryDraft(
  story: StarStoryView | undefined,
  facts: readonly StarStoryFactView[],
  onSave: (input: StarStoryWriteInput) => Promise<boolean>,
  saving: boolean,
) {
  const [title, setTitle] = useState(story?.title ?? '');
  const [fields, setFields] = useState(story?.fields ?? EMPTY_FIELDS);
  const availableIds = new Set(facts.map((fact) => fact.id));
  const [sourceFactIds, setSourceFactIds] = useState<readonly string[]>(
    story?.sourceFactIds.filter((id) => availableIds.has(id)) ?? [],
  );
  const selectedFacts = facts.filter((fact) => sourceFactIds.includes(fact.id));
  const confidence = starStoryEvidenceStatus(fields.result, sourceFactIds, selectedFacts);
  const resultNeedsSource = starResultHasNumbers(fields.result) && confidence !== 'confirmed';
  const empty = STAR_FIELDS.every((field) => !fields[field].trim());
  const canSave = title.trim().length > 0 && !empty && !resultNeedsSource && !saving;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;
    void onSave({ title: title.trim(), fields: trimFields(fields), sourceFactIds });
  };
  const setField = (field: StarField, value: string) =>
    setFields((current) => ({ ...current, [field]: value }));
  return {
    title,
    fields,
    sourceFactIds,
    confidence,
    resultNeedsSource,
    canSave,
    submit,
    setTitle,
    setField,
    setSourceFactIds,
  };
}

function StarStoryEditorError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="career-star-story-error" role="alert">
      {error}
    </p>
  );
}

function StarStoryFieldsForm({
  title,
  fields,
  onTitle,
  onField,
}: {
  title: string;
  fields: StarStoryView['fields'] | typeof EMPTY_FIELDS;
  onTitle: (value: string) => void;
  onField: (field: StarField, value: string) => void;
}) {
  return (
    <>
      <label className="career-star-story-title-field">
        <span>Название истории</span>
        <input
          value={title}
          maxLength={160}
          onChange={(event) => onTitle(event.currentTarget.value)}
        />
      </label>
      <div className="career-star-story-field-list">
        {STAR_FIELDS.map((field) => (
          <StarStoryFieldInput
            key={field}
            field={field}
            value={fields[field]}
            onChange={(value) => onField(field, value)}
          />
        ))}
      </div>
    </>
  );
}

function StarStoryEvidenceNote({
  confidence,
  resultNeedsSource,
}: {
  confidence: 'confirmed' | 'unconfirmed';
  resultNeedsSource: boolean;
}) {
  if (resultNeedsSource) {
    return (
      <p className="career-star-story-evidence-warning" role="alert">
        <WarningCircle size={17} aria-hidden="true" /> Числа в результате должны совпасть с
        выбранным фактом-источником.
      </p>
    );
  }
  return confidence === 'unconfirmed' ? (
    <p className="career-star-story-unconfirmed-note" role="status">
      <WarningCircle size={17} aria-hidden="true" /> Без факта-основания история сохранится как «Не
      подтверждено».
    </p>
  ) : (
    <p className="career-star-story-confirmed-note" role="status">
      <CheckCircle size={17} aria-hidden="true" /> Подтверждено выбранным фактом.
    </p>
  );
}

function StarStoryEditorActions({
  saving,
  canSave,
  onCancel,
}: {
  saving: boolean;
  canSave: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="career-star-story-editor-actions">
      <button type="button" className="career-btn career-btn-secondary" onClick={onCancel}>
        Отмена
      </button>
      <button type="submit" className="career-btn career-btn-primary" disabled={!canSave}>
        {saving ? 'Сохраняем…' : 'Сохранить историю'}
      </button>
    </div>
  );
}

function StarStoryFieldInput({
  field,
  value,
  onChange,
}: {
  field: StarField;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="career-star-story-field">
      <span>{FIELD_LABELS[field]}</span>
      <textarea
        value={value}
        rows={3}
        maxLength={4_000}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function StarStoryFactPicker({
  facts,
  sourceFactIds,
  onChange,
}: {
  facts: readonly StarStoryFactView[];
  sourceFactIds: readonly string[];
  onChange: (ids: readonly string[]) => void;
}) {
  const toggleFact = (factId: string, selected: boolean) => {
    onChange(selected ? [...sourceFactIds, factId] : sourceFactIds.filter((id) => id !== factId));
  };
  return (
    <fieldset className="career-star-story-facts">
      <legend>Факты-источники</legend>
      {facts.length ? (
        facts.map((fact) => (
          <label className="career-star-story-fact-option" key={fact.id}>
            <input
              type="checkbox"
              checked={sourceFactIds.includes(fact.id)}
              onChange={(event) => toggleFact(fact.id, event.currentTarget.checked)}
            />
            <span>{fact.statement}</span>
          </label>
        ))
      ) : (
        <p className="career-star-story-unconfirmed-note">
          В профиле пока нет подтверждённых фактов.
        </p>
      )}
    </fieldset>
  );
}

function trimFields(fields: typeof EMPTY_FIELDS): typeof EMPTY_FIELDS {
  return {
    situation: fields.situation.trim(),
    task: fields.task.trim(),
    action: fields.action.trim(),
    result: fields.result.trim(),
  };
}
