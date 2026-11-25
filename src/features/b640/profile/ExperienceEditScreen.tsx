import { useRef, useState, type FormEvent } from 'react';
import type {
  FactCorrectionOutcome,
  FactCorrectionProposal,
} from '../../../../shared/factCorrection';
import { apiErrorMessage } from '../../coach/apiClient';
import { getResumeStudio, saveResumeStudioDraft } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import type { ResumeDraft, ResumeExperienceInput } from '../../resume/resumeTypes';
import { FactCorrectionCard } from '../consultant/FactCorrectionCard';
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
  withDescription,
  type ExperienceForm,
  type ExperienceFormErrors,
} from './experienceForm';
import {
  addDescription,
  createFactWriter,
  dropUnusedDescription,
  revertTexts,
  saveTexts,
  type FactWriter,
} from './experienceResults';
import { DescriptionField, ResultsField } from './ExperienceTexts';
import { statementsOf } from './profileModel';

const PROFILE_PATH = buildNodePath('s01');

interface Loaded {
  readonly draft: ResumeDraft | null;
  readonly statements: ReadonlyMap<string, string>;
}

function loadProfile(): Promise<Loaded> {
  forgetSharedRead('resume');
  return getResumeStudio().then((view) => ({ draft: view.draft, statements: statementsOf(view) }));
}

interface EditorProps {
  readonly entry: ResumeExperienceInput;
  readonly initial: ExperienceForm;
}

/** Событие «профиль изменён»: открытый экран профиля перечитывает данные. */
export const PROFILE_CHANGED = 'openqareer:b640-profile-changed';

/**
 * Свежий черновик перед записью: сохраняется весь профиль целиком, поэтому
 * правку накладываем на то, что на сервере сейчас, а не на прочитанное при открытии.
 */
export async function freshDraft(): Promise<ResumeDraft> {
  forgetSharedRead('resume');
  const view = await getResumeStudio();
  if (!view.draft) throw new Error('profile_draft_missing');
  return view.draft;
}

type SavedTexts = FactCorrectionOutcome;

async function saveEntry(
  { entry, initial }: EditorProps,
  form: ExperienceForm,
  facts: FactWriter,
  onSaved: (outcome: SavedTexts) => void,
): Promise<void> {
  await saveTexts(entry, initial, form, facts, onSaved);
  const descriptionId = await addDescription(entry, form, facts);
  const draft = await freshDraft();
  if (!draft.experience.some((item) => item.id === entry.id)) {
    throw new Error('profile_entry_missing');
  }
  await dropUnusedDescription(form, draft, facts);
  await saveResumeStudioDraft(
    withDescription(applyForm(draft, entry.id, form), entry.id, descriptionId),
  );
}

async function undoEntry(
  entry: ResumeExperienceInput,
  saved: readonly SavedTexts[],
): Promise<void> {
  await revertTexts(saved);
  await saveResumeStudioDraft(restoreEntry(await freshDraft(), entry));
  window.dispatchEvent(new Event(PROFILE_CHANGED));
}

/** Сохранение правки: после него — в профиль, тост даёт отменить. */
function useSave(props: EditorProps) {
  const { entry } = props;
  // Тексты, записанные до сбоя: «Отменить» после повтора вернёт и их.
  const saved = useRef<readonly SavedTexts[]>([]);
  const [facts] = useState(createFactWriter);
  const { navigate } = useShell();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<readonly FactCorrectionProposal[]>([]);

  async function undo() {
    try {
      await undoEntry(entry, saved.current);
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
      await saveEntry(props, form, facts, (outcome) => {
        saved.current = [...saved.current, outcome];
      });
      window.dispatchEvent(new Event(PROFILE_CHANGED));
      toast.show({ text: 'Сохранено', undo: { label: 'Отменить', onUndo: () => void undo() } });
      const similar = saved.current.flatMap(({ proposals }) => proposals);
      if (similar.length === 0) navigate(PROFILE_PATH);
      else setPending(similar);
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить. Нажмите ещё раз.'));
      setBusy(false);
    }
  }

  return { busy, error, save, pending };
}

/** Кнопки формы: на 390 — закреплённая полоса, на широком окне — под формой. */
export function FormActions({ busy }: { readonly busy: boolean }) {
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

function Editor(props: EditorProps) {
  const { entry, initial } = props;
  const [form, setForm] = useState<ExperienceForm>(initial);
  const [errors, setErrors] = useState<ExperienceFormErrors>({});
  const { busy, error, save, pending } = useSave(props);
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

  if (pending.length > 0) return <Similar proposals={pending} />;
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
      <DescriptionField form={form} onChange={change} isNew={!entry.descriptionMemoryId} />
      <ResultsField form={form} onChange={change} />
      <SkillsField form={form} onChange={change} />
      {error ? <StatusLine state="err" text={error} /> : null}
      <FormActions busy={busy} />
    </form>
  );
}

/** Похожие записи после правки: меняются только с согласия кандидата. */
function Similar({ proposals }: { readonly proposals: readonly FactCorrectionProposal[] }) {
  return (
    <>
      {proposals.map((proposal) => (
        <FactCorrectionCard key={proposal.before} proposal={proposal} />
      ))}
      <div className="actions">
        <Link className="btn" to={PROFILE_PATH}>
          <Icon name="back" />
          Открыть профиль
        </Link>
      </div>
    </>
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
  const draft = useLoad(loadProfile);
  const entry =
    draft.state === 'ready'
      ? (draft.data.draft?.experience.find((item) => item.id === entryId) ?? null)
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
          {draft.state === 'ready' && entry ? (
            <Editor entry={entry} initial={formOf(entry, draft.data.statements)} key={entry.id} />
          ) : null}
          {draft.state === 'ready' && !entry ? <Missing /> : null}
        </section>
      </div>
    </div>
  );
}
