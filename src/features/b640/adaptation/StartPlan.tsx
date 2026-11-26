import { useState, type FormEvent } from 'react';
import type { CareerDiaryWorkplace } from '../../../../shared/careerDiary';
import { createCareerDiaryAdaptationPlan, createCareerDiaryAdaptationPlanFromSteps } from '../../diary/careerDiaryPlanning';
import { ActionDock } from '../kit/ActionDock';
import { Button } from '../kit/Button';
import { DateInput } from '../kit/DateInput';
import { StatusLine } from '../kit/ResultLine';
import { fetchVacancyDetail } from '../../vacancies/vacancyDetailApi';
import { createWorkplace, generateSteps, savePlan, type NewWorkplace } from './adaptationApi';
import { CompanyField } from './CompanyField';
import { dutiesFromVacancy, EXPECTATIONS_MAX, type CompanySuggestion } from './responseCompanies';

export function Field(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly type?: 'text' | 'date';
  readonly placeholder?: string;
  readonly error?: string;
  /** Ширина поля по макету: `gb-name` — длинное, `gb-date` — дата. */
  readonly className?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className={props.className ? `gb-f ${props.className}` : 'gb-f'}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.type === 'date' ? (
        <DateInput id={props.id} value={props.value} error={props.error} onChange={props.onChange} />
      ) : (
        <>
          <input
            id={props.id}
            type="text"
            value={props.value}
            maxLength={200}
            placeholder={props.placeholder}
            aria-invalid={props.error ? true : undefined}
            onChange={(event) => props.onChange(event.currentTarget.value)}
          />
          {props.error ? <p className="va-err" role="alert">{props.error}</p> : null}
        </>
      )}
    </div>
  );
}

const EMPTY = { company: '', title: '', startDate: '', expectations: '' };
type Draft = typeof EMPTY;
type Errors = Partial<Record<keyof Draft, string>>;

function errorsOf(draft: Draft): Errors {
  return {
    ...(draft.company.trim() ? {} : { company: 'Укажите компанию' }),
    ...(draft.title.trim() ? {} : { title: 'Укажите должность' }),
    ...(draft.startDate ? {} : { startDate: 'Укажите день выхода' }),
  };
}

function workplaceInput(draft: Draft): NewWorkplace {
  const expectations = draft.expectations.trim();
  return {
    company: draft.company.trim(),
    title: draft.title.trim(),
    startDate: draft.startDate,
    ...(expectations ? { expectations } : {}),
  };
}

const STEPS_MIN = 3;

/** d01: план из обязанностей, если модель разложила их; иначе — шаблон. Путь кандидату не виден. */
async function buildPlan(workplace: CareerDiaryWorkplace, hasExpectations: boolean) {
  const createdAt = new Date().toISOString();
  const steps = hasExpectations ? await generateSteps(workplace.id).catch(() => null) : null;
  return steps && steps.length >= STEPS_MIN
    ? createCareerDiaryAdaptationPlanFromSteps(workplace, steps, createdAt)
    : createCareerDiaryAdaptationPlan(workplace, createdAt);
}

/** Состояние формы: черновик, ошибки, отправка и подстановка из отклика. */
function useStartForm(onDone: () => void) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = (key: keyof Draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  // Обязанности вакансии кладутся, только если кандидат ещё ничего не написал сам.
  const pick = (item: CompanySuggestion) => {
    setDraft((current) => ({ ...current, company: item.company, title: current.title.trim() ? current.title : item.title }));
    if (!item.clusterId) return;
    fetchVacancyDetail(item.clusterId)
      .then((detail) => {
        const duties = dutiesFromVacancy(detail);
        setDraft((current) => (current.expectations.trim() || !duties ? current : { ...current, expectations: duties }));
      })
      .catch(() => undefined);
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = errorsOf(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const workplace = await createWorkplace(workplaceInput(draft));
      await savePlan(workplace.id, await buildPlan(workplace, Boolean(draft.expectations.trim())));
      onDone();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return { draft, errors, busy, failed, set, pick, submit };
}

/** d01g: места работы нет — компания, должность, день выхода и что от вас ждут. */
export function StartWorkplace({ onDone }: { readonly onDone: () => void }) {
  const { draft, errors, busy, failed, set, pick, submit } = useStartForm(onDone);
  return (
    <>
      <section className="lead" aria-labelledby="ap-start">
        <h2 className="lead-title is-long" id="ap-start">Чтобы собрать план, укажите, куда вы выходите</h2>
      </section>
      <form className="gb-form" onSubmit={(event) => void submit(event)} aria-labelledby="ap-start">
        <CompanyField value={draft.company} error={errors.company} onChange={set('company')} onPick={pick} />
        <Field id="ap-title" label="Должность" className="gb-name" value={draft.title} error={errors.title} onChange={set('title')} />
        <Field id="ap-start-date" label="День выхода" className="gb-date" type="date" value={draft.startDate} error={errors.startDate} onChange={set('startDate')} />
        <div className="gb-f gb-long">
          <label htmlFor="ap-expectations">Что от вас ждут</label>
          <textarea
            id="ap-expectations"
            rows={5}
            maxLength={EXPECTATIONS_MAX}
            value={draft.expectations}
            onChange={(event) => set('expectations')(event.currentTarget.value)}
          />
        </div>
        {failed ? <StatusLine state="err" text="План не создался, попробуйте ещё раз" /> : null}
        <ActionDock
          kind="commit"
          primary={<Button variant="primary" type="submit" icon="path" busy={busy}>Собрать план</Button>}
        />
      </form>
    </>
  );
}

/** Место работы есть, плана нет. */
export function StartTemplate({ onStart }: { readonly onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function start() {
    setBusy(true);
    setFailed(false);
    try {
      await onStart();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lead" aria-labelledby="ap-empty">
      <h2 className="lead-title" id="ap-empty">План первых 90 дней на новом месте</h2>
      {failed ? <StatusLine state="err" text="План не создался, попробуйте ещё раз" /> : null}
      <ActionDock
        kind="commit"
        primary={<Button variant="primary" icon="plus" busy={busy} onClick={() => void start()}>Начать план</Button>}
      />
    </section>
  );
}
