import { useId, useState } from 'react';
import {
  LINKEDIN_COMMENTS_PER_DAY_MAX,
  LINKEDIN_RHYTHM_DAYS,
  type LinkedinCommentRhythm,
  type LinkedinRhythm,
  type LinkedinRhythmDay,
} from '../../../../../shared/b640LinkedinQueue';
import { Button, Icon } from '../../kit';
import { saveRhythm } from './linkedinQueueApi';
import { DAY_LABELS, orderedDays, windowError } from './rhythmModel';

const PER_DAY = Array.from({ length: LINKEDIN_COMMENTS_PER_DAY_MAX }, (_, index) => index + 1);

interface FormProps {
  readonly rhythm: LinkedinRhythm;
  readonly onSaved: (rhythm: LinkedinRhythm) => void;
  readonly onCancel: () => void;
}

function PerDay({
  value,
  onChange,
}: {
  readonly value: number;
  readonly onChange: (next: number) => void;
}) {
  return (
    <div className="va-pop-f">
      <span className="va-pop-l" id="rh-per">
        В день
      </span>
      <div className="seg rh-seg" role="group" aria-labelledby="rh-per">
        {PER_DAY.map((count) => (
          <button
            key={count}
            className="seg-i"
            type="button"
            aria-pressed={value === count}
            onClick={() => onChange(count)}
          >
            {value === count ? <Icon name="check" /> : null}
            {count}
          </button>
        ))}
      </div>
    </div>
  );
}

function Days({
  value,
  onToggle,
}: {
  readonly value: readonly LinkedinRhythmDay[];
  readonly onToggle: (day: LinkedinRhythmDay) => void;
}) {
  return (
    <div className="va-pop-f">
      <span className="va-pop-l" id="rh-days">
        Дни
      </span>
      <div className="chips va-pop-chips" role="group" aria-labelledby="rh-days">
        {LINKEDIN_RHYTHM_DAYS.map((day) => (
          <button
            key={day}
            className="chip"
            type="button"
            aria-pressed={value.includes(day)}
            onClick={() => onToggle(day)}
          >
            {DAY_LABELS[day]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Window({
  from,
  to,
  onChange,
}: {
  readonly from: string;
  readonly to: string;
  readonly onChange: (next: { from: string; to: string }) => void;
}) {
  return (
    <div className="va-pop-f">
      <span className="va-pop-l" id="rh-time">
        Время
      </span>
      <div className="rh-time" role="group" aria-labelledby="rh-time">
        <label htmlFor="rh-from">с</label>
        <input
          id="rh-from"
          type="text"
          inputMode="numeric"
          value={from}
          aria-label="С какого времени"
          onChange={(event) => onChange({ from: event.target.value.trim(), to })}
        />
        <label htmlFor="rh-to">до</label>
        <input
          id="rh-to"
          type="text"
          inputMode="numeric"
          value={to}
          aria-label="До какого времени"
          onChange={(event) => onChange({ from, to: event.target.value.trim() })}
        />
      </div>
    </div>
  );
}

function useRhythmForm({ rhythm, onSaved }: Pick<FormProps, 'rhythm' | 'onSaved'>) {
  const [draft, setDraft] = useState<LinkedinCommentRhythm>(rhythm.comments);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (day: LinkedinRhythmDay) => {
    const days = draft.days.includes(day)
      ? draft.days.filter((item) => item !== day)
      : [...draft.days, day];
    setDraft({ ...draft, days: orderedDays(days) });
  };
  const save = () => {
    const problem = draft.days.length
      ? windowError(draft.from, draft.to)
      : 'Выберите хотя бы один день';
    setError(problem);
    if (problem) return;
    setBusy(true);
    saveRhythm({ ...rhythm, comments: draft })
      .then(onSaved)
      .catch(() => setError('Ритм не сохранился. Попробуйте ещё раз'))
      .finally(() => setBusy(false));
  };
  return { draft, setDraft, toggle, save, error, busy };
}

function RhythmForm({
  rhythm,
  onSaved,
  onCancel,
  titleId,
}: FormProps & { readonly titleId: string }) {
  const form = useRhythmForm({ rhythm, onSaved });
  return (
    <div className="va-pop" id="va-pop-rh" role="dialog" aria-labelledby={titleId}>
      <h3 className="va-pop-t" id={titleId}>
        Ритм публикации
      </h3>
      <PerDay
        value={form.draft.perDay}
        onChange={(perDay) => form.setDraft({ ...form.draft, perDay })}
      />
      <Days value={form.draft.days} onToggle={form.toggle} />
      <Window
        from={form.draft.from}
        to={form.draft.to}
        onChange={(window) => form.setDraft({ ...form.draft, ...window })}
      />
      {form.error ? (
        <p className="row-sub" role="alert">
          {form.error}
        </p>
      ) : null}
      <div className="va-pop-foot">
        <Button variant="primary" busy={form.busy} onClick={form.save}>
          Сохранить
        </Button>
        <Button onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  );
}

/** a05e: «Настроить ритм» — всплывашка с «В день», днями и окном времени. */
export function RhythmPopover({
  rhythm,
  onSaved,
  primary = false,
}: {
  readonly rhythm: LinkedinRhythm;
  readonly onSaved: (rhythm: LinkedinRhythm) => void;
  /** a05b: на 390 главная кнопка уходит в полосу над навигацией, всплывашка — листом. */
  readonly primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return (
    <span className="va-popwrap">
      <Button
        variant={primary ? 'primary' : 'default'}
        icon="sliders"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="va-pop-rh"
        onClick={() => setOpen((value) => !value)}
      >
        Настроить ритм
      </Button>
      {open ? (
        <RhythmForm
          rhythm={rhythm}
          titleId={titleId}
          onCancel={() => setOpen(false)}
          onSaved={(saved) => {
            setOpen(false);
            onSaved(saved);
          }}
        />
      ) : null}
    </span>
  );
}
