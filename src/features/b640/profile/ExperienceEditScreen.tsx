import { useState, type FormEvent } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import { getResumeStudio, saveResumeStudioDraft } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import type { ResumeDraft, ResumeExperienceInput } from '../../resume/resumeTypes';
import { Button, Icon, Link, StatusLine, useToast } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import {
  CityField,
  FormatField,
  PeriodFields,
  SkillsField,
  TeamField,
  TextField,
} from './ExperienceFields';
import {
  applyForm,
  formOf,
  restoreEntry,
  validateForm,
  type ExperienceForm,
  type ExperienceFormErrors,
} from './experienceForm';

const PROFILE_PATH = buildNodePath('s01');

function loadDraft(): Promise<ResumeDraft | null> {
  forgetSharedRead('resume');
  return getResumeStudio().then((view) => view.draft);
}

interface EditorProps {
  readonly entry: ResumeExperienceInput;
}

/** Событие «профиль изменён»: открытый экран профиля перечитывает данные. */
export const PROFILE_CHANGED = 'openqareer:b640-profile-changed';

/**
 * Свежий черновик перед записью: сохраняется весь профиль целиком, поэтому
 * правку накладываем на то, что на сервере сейчас, а не на прочитанное при открытии.
 */
async function freshDraft(): Promise<ResumeDraft> {
  forgetSharedRead('resume');
  const view = await getResumeStudio();
  if (!view.draft) throw new Error('profile_draft_missing');
  return view.draft;
}

async function saveEntry(entry: ResumeExperienceInput, form: ExperienceForm): Promise<void> {
  const draft = await freshDraft();
  if (!draft.experience.some((item) => item.id === entry.id)) {
    throw new Error('profile_entry_missing');
  }
  await saveResumeStudioDraft(applyForm(draft, entry.id, form));
}

async function undoEntry(entry: ResumeExperienceInput): Promise<void> {
  await saveResumeStudioDraft(restoreEntry(await freshDraft(), entry));
  window.dispatchEvent(new Event(PROFILE_CHANGED));
}

/** Сохранение правки: после него — в профиль, тост даёт отменить. */
function useSave({ entry }: EditorProps) {
  const { navigate } = useShell();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function undo() {
    try {
      await undoEntry(entry);
      toast.show({ text: 'Правка отменена' });
    } catch {
      toast.show({ text: 'Не удалось отменить правку' });
    }
  }

  async function save(form: ExperienceForm) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveEntry(entry, form);
      toast.show({ text: 'Сохранено', undo: { label: 'Отменить', onUndo: () => void undo() } });
      navigate(PROFILE_PATH);
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить. Нажмите ещё раз.'));
      setBusy(false);
    }
  }

  return { busy, error, save };
}

/** Кнопки формы: на 390 — закреплённая полоса, на широком окне — под формой. */
function FormActions({ busy }: { readonly busy: boolean }) {
  return (
    <>
      <div className="actions m-commit pf-mob pf-mbar">
        <Link className="row-act" to={PROFILE_PATH}>
          Отмена
        </Link>
        <Button type="submit" variant="primary" icon="check" busy={busy}>
          Сохранить
        </Button>
      </div>
      <div className="actions pf-desk">
        <Button type="submit" variant="primary" icon="check" busy={busy}>
          Сохранить
        </Button>
        <Link className="btn is-quiet" to={PROFILE_PATH}>
          <Icon name="close" />
          Отмена
        </Link>
      </div>
    </>
  );
}

function Editor({ entry }: EditorProps) {
  const [form, setForm] = useState<ExperienceForm>(() => formOf(entry));
  const [errors, setErrors] = useState<ExperienceFormErrors>({});
  const { busy, error, save } = useSave({ entry });
  const change = (patch: Partial<ExperienceForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateForm(form, entry);
    setErrors(found);
    if (Object.keys(found).length === 0) void save(form);
  }

  const fields = { form, errors, onChange: change };
  return (
    <form className="pf-form" aria-label="Правка места работы" noValidate onSubmit={submit}>
      <div className="pf-two">
        <TextField
          id="co"
          label="Компания"
          value={form.employer}
          error={errors.employer}
          onChange={(employer) => change({ employer })}
        />
        <TextField
          id="po"
          label="Должность"
          value={form.title}
          error={errors.title}
          onChange={(title) => change({ title })}
        />
      </div>
      <PeriodFields {...fields} />
      <div className="pf-three">
        <CityField {...fields} />
        <FormatField form={form} onChange={change} />
        <TeamField {...fields} />
      </div>
      <SkillsField form={form} onChange={change} />
      {error ? <StatusLine state="err" text={error} /> : null}
      <FormActions busy={busy} />
    </form>
  );
}

function Missing() {
  return (
    <>
      <p className="mod-text">Такой записи в профиле нет</p>
      <div className="actions">
        <Link className="btn" to={PROFILE_PATH}>
          <Icon name="back" />
          Открыть профиль
        </Link>
      </div>
    </>
  );
}

export interface ExperienceEditProps {
  readonly node: B640Node;
  readonly entryId: string;
}

/** p07 «Правка места работы»: компания, должность, период, город, формат, команда, инструменты. */
export function ExperienceEditScreen({ node, entryId }: ExperienceEditProps) {
  const draft = useLoad(loadDraft);
  const entry =
    draft.state === 'ready'
      ? (draft.data?.experience.find((item) => item.id === entryId) ?? null)
      : null;
  useScreenChrome(entry?.employer ? { crumb: entry.employer } : {});
  return (
    <div className="page pf" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="lead" aria-labelledby="pf-t">
          <h2 className="lead-title is-long" id="pf-t">
            Правка места работы
          </h2>
          {draft.state === 'loading' ? <BlockSkeleton label="Загружаем запись" rows={3} /> : null}
          {draft.state === 'error' ? (
            <BlockError text="Не удалось загрузить запись." onRetry={draft.retry} />
          ) : null}
          {draft.state === 'ready' && draft.data && entry ? (
            <Editor entry={entry} key={entry.id} />
          ) : null}
          {draft.state === 'ready' && !entry ? <Missing /> : null}
        </section>
      </div>
    </div>
  );
}
