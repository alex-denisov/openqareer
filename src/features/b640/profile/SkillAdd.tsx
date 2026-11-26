import { useState, type FormEvent } from 'react';
import { saveResumeStudioDraft } from '../../resume/resumeApi';
import { Icon } from '../kit';
import { freshDraft, PROFILE_CHANGED } from './ExperienceEditScreen';
import { SKILL_NAME_MAX, withSkill } from './skillAddModel';

/** Накладываем навык на свежий профиль: чужие правки не затираются. */
async function addSkill(name: string): Promise<void> {
  const draft = await freshDraft();
  const next = withSkill(draft, name, crypto.randomUUID());
  if (next !== draft) await saveResumeStudioDraft(next);
  window.dispatchEvent(new Event(PROFILE_CHANGED));
}

interface SkillFieldProps {
  readonly name: string;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onName: (value: string) => void;
  readonly onSave: () => void;
}

function SkillField({ name, busy, failed, onName, onSave }: SkillFieldProps) {
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && name.trim()) onSave();
  }
  return (
    <form className="field" noValidate onSubmit={submit}>
      <label htmlFor="sk-add">Навык</label>
      <input
        id="sk-add"
        type="text"
        enterKeyHint="done"
        placeholder="Например, Terraform"
        maxLength={SKILL_NAME_MAX}
        value={name}
        readOnly={busy}
        aria-invalid={failed || undefined}
        aria-describedby={failed ? 'sk-add-e' : undefined}
        onChange={(event) => onName(event.target.value)}
      />
      {failed ? (
        <small className="is-err" id="sk-add-e" role="alert">
          <Icon name="warn" />
          Навык не сохранился
        </small>
      ) : null}
    </form>
  );
}

/** «Добавить навык» в ряду навыков: поле открывается на месте, Enter сохраняет. */
export function SkillAdd() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    setBusy(true);
    setFailed(false);
    try {
      await addSkill(name);
      setName('');
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="skill-add"
      open={open}
      onToggle={(event) => {
        // Событие всплывает в React: сам раздел «Навыки» тоже details.
        event.stopPropagation();
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="skill-chip is-add">
        <Icon name="plus" />
        Добавить навык
      </summary>
      <SkillField
        name={name}
        busy={busy}
        failed={failed}
        onName={setName}
        onSave={() => void save()}
      />
    </details>
  );
}
