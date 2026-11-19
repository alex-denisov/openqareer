import type { CareerDiaryWeekDraft } from '../../../../shared/careerDiaryEntries';
import { InfoTip } from '../kit/InfoTip';
import { planSourceText, type MeterField, type WeekForm } from './weekModel';

interface StepProps {
  readonly form: WeekForm;
  readonly change: (patch: Partial<WeekForm>) => void;
}

/** «Замеры»: числовые показатели целей, «было …» в плейсхолдере. */
export function MetersStep({
  form,
  change,
  meters,
}: StepProps & { readonly meters: readonly MeterField[] }) {
  if (meters.length === 0) return null;
  return (
    <li className="dn-fs">
      <h3>Замеры</h3>
      {meters.map((field) => (
        <div className="dn-kpi-in" key={field.goalId}>
          <label htmlFor={`kv-${field.goalId}`}>{field.label}</label>
          <input
            id={`kv-${field.goalId}`}
            type="text"
            inputMode="decimal"
            value={form.meters[field.goalId] ?? ''}
            placeholder={field.placeholder}
            onChange={(event) =>
              change({ meters: { ...form.meters, [field.goalId]: event.target.value } })
            }
          />
        </div>
      ))}
    </li>
  );
}

export function BlockersStep({ form, change }: StepProps) {
  return (
    <li className="dn-fs">
      <h3>Что мешает</h3>
      <div className="field">
        <label className="vh" htmlFor="wk-bad">
          Что мешает
        </label>
        <textarea
          id="wk-bad"
          value={form.blockers}
          onChange={(event) => change({ blockers: event.target.value })}
        />
      </div>
    </li>
  );
}

/** «План на неделю»: снятая галочка убирает пункт из плана. */
export function PlanStep({
  form,
  change,
  draft,
}: StepProps & { readonly draft: CareerDiaryWeekDraft }) {
  if (form.plan.length === 0) return null;
  const keep = (key: string, kept: boolean) =>
    change({ plan: form.plan.map((item) => (item.key === key ? { ...item, kept } : item)) });
  return (
    <li className="dn-fs">
      <h3>
        План на неделю
        <InfoTip label="Откуда план" text={planSourceText(draft)} />
      </h3>
      <ul className="checks">
        {form.plan.map((row) => (
          <li className="check" key={row.key}>
            <input
              type="checkbox"
              id={`pl-${row.key}`}
              checked={row.kept}
              onChange={(event) => keep(row.key, event.target.checked)}
            />
            <label htmlFor={`pl-${row.key}`}>
              {row.text}
              {row.goalTitle ? <span className="when">{` · ${row.goalTitle}`}</span> : null}
            </label>
          </li>
        ))}
      </ul>
    </li>
  );
}
