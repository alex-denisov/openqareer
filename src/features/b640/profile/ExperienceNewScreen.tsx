import { useState, type FormEvent } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import { getResumeStudio, saveResumeStudioDraft } from '../../resume/resumeApi';
import { forgetSharedRead } from '../../resume/sharedRead';
import { StatusLine, useToast } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import { FormActions, PROFILE_CHANGED } from './ExperienceEditScreen';
import {
  CityField,
  FormatField,
  PeriodFields,
  SkillsField,
  TeamField,
  TextField,
} from './ExperienceFields';
import {
  formOf,
  validateForm,
  withDescription,
  type ExperienceForm,
  type ExperienceFormErrors,
} from './experienceForm';
import { addDescription, createTextKeys, saveTexts } from './experienceResults';
import { DescriptionField, ResultsField } from './ExperienceTexts';
import { blankEntry, withNewEntry } from './newExperience';

function useNewEntry() {
  const { navigate } = useShell();
  const toast = useToast();
  const [entry] = useState(() => blankEntry(crypto.randomUUID()));
  const [form, setForm] = useState<ExperienceForm>(() => formOf(entry));
  const [keyOf] = useState(createTextKeys);
  const [errors, setErrors] = useState<ExperienceFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      forgetSharedRead('resume');
      const { draft } = await getResumeStudio();
      const descriptionId = await addDescription(entry, form, keyOf);
      await saveResumeStudioDraft(
        withDescription(withNewEntry(draft, entry, form), entry.id, descriptionId),
      );
      await saveTexts(entry, formOf(entry), form, () => undefined);
      window.dispatchEvent(new Event(PROFILE_CHANGED));
      toast.show({ text: 'Сохранено' });
      navigate(buildNodePath('s01'));
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить. Нажмите ещё раз.'));
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateForm(form, entry);
    setErrors(found);
    if (!busy && Object.keys(found).length === 0) void save();
  }

  const change = (patch: Partial<ExperienceForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };
  return { form, errors, busy, error, change, submit };
}

/** p07 без записи: место работы, которое кандидат вносит сам («Заполнить вручную» на p04). */
export function ExperienceNewScreen({ node }: { readonly node: B640Node }) {
  const { form, errors, busy, error, change, submit } = useNewEntry();
  const fields = { form, errors, onChange: change };
  return (
    <div className="page pf" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="lead" aria-labelledby="pf-t">
          <h2 className="lead-title is-long" id="pf-t">
            Место работы
          </h2>
          <form className="pf-form" aria-label="Место работы" noValidate onSubmit={submit}>
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
            <DescriptionField form={form} onChange={change} isNew />
            <ResultsField form={form} onChange={change} />
            <SkillsField form={form} onChange={change} />
            {error ? <StatusLine state="err" text={error} /> : null}
            <FormActions busy={busy} />
          </form>
        </section>
      </div>
    </div>
  );
}
