import { useState, type FormEvent } from 'react';
import { DIARY_NOTE_MAX, type CareerDiaryFirstMeeting } from '../../../../shared/careerDiaryCards';
import { ActionDock } from '../kit/ActionDock';
import { Button } from '../kit/Button';
import { Icon } from '../kit/Icon';
import { StatusLine } from '../kit/ResultLine';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { dayLabel } from './adaptationModel';
import { AdaptationGate, type AdaptationActions } from './AdaptationGate';
import { Field } from './StartPlan';
import { TaskChecks } from './TaskChecks';
import type { AdaptationData } from './useAdaptation';

type Notes = Omit<CareerDiaryFirstMeeting, 'heldOn' | 'manager'>;
const FACTS: readonly (readonly [keyof Notes, string])[] = [
  ['expectations', 'Ожидания'],
  ['successByDay90', 'Успех к 90-му дню'],
  ['measures', 'Как измеряем'],
  ['cadence', 'Встречи'],
  ['needsApproval', 'Что менять только с согласования'],
  ['ownDecisions', 'Что решаю сам'],
];
const BLANK: CareerDiaryFirstMeeting = {
  heldOn: null, expectations: '', successByDay90: '', measures: '', cadence: '', needsApproval: '', ownDecisions: '', manager: '',
};

function Note({ id, label, value, onChange }: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="gb-f">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="ap-note" rows={2} maxLength={DIARY_NOTE_MAX} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </div>
  );
}

function MeetingForm({ meeting, onSave, onCancel }: {
  readonly meeting: CareerDiaryFirstMeeting;
  readonly onSave: (meeting: CareerDiaryFirstMeeting) => Promise<void>;
  readonly onCancel: (() => void) | null;
}) {
  const [draft, setDraft] = useState(meeting);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      await onSave(draft);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <form className="gb-form" aria-label="Итоги встречи" onSubmit={(event) => void submit(event)}>
      <Field id="mt-day" label="День встречи" type="date" value={draft.heldOn ?? ''} onChange={(value) => setDraft({ ...draft, heldOn: value || null })} />
      <Field id="mt-who" label="Руководитель" value={draft.manager} placeholder="Например: Ирина Лаврова, директор по технологиям" onChange={(manager) => setDraft({ ...draft, manager })} />
      {FACTS.map(([key, label]) => (
        <Note key={key} id={`mt-${key}`} label={label} value={draft[key]} onChange={(value) => setDraft({ ...draft, [key]: value })} />
      ))}
      {failed ? <StatusLine state="err" text="Итоги не сохранились, попробуйте ещё раз" /> : null}
      <ActionDock
        kind="commit"
        primary={<Button variant="primary" icon="check" type="submit" busy={busy}>Сохранить итоги</Button>}
        secondary={onCancel ? <Button onClick={onCancel}>Отмена</Button> : undefined}
      />
    </form>
  );
}

function Facts({ meeting, onEdit }: { readonly meeting: CareerDiaryFirstMeeting; readonly onEdit: () => void }) {
  return (
    <div className="dn-fs">
      <h3>{meeting.heldOn ? `Итоги встречи · ${dayLabel(meeting.heldOn)}` : 'Итоги встречи'}</h3>
      <ul className="facts">
        {FACTS.filter(([key]) => meeting[key]).map(([key, label]) => (
          <li className="fact" key={key}>
            <span className="k">{label}</span>
            <span className="v">{meeting[key]}</span>
          </li>
        ))}
      </ul>
      <button className="row-act" type="button" onClick={onEdit}>Изменить итоги</button>
    </div>
  );
}

function MeetingBody({ data, actions }: { readonly data: AdaptationData; readonly actions: AdaptationActions }) {
  const meeting = data.view.firstMeeting;
  const [editing, setEditing] = useState(meeting === null);
  const step = data.view.steps.find((item) => item.id === 'first_meeting');
  const tasks = step?.groups.flatMap((group) => group.tasks) ?? [];
  async function save(next: CareerDiaryFirstMeeting) {
    await actions.patchDetails({ firstMeeting: next });
    setEditing(false);
  }
  return (
    <>
      <section className="lead" aria-labelledby="mt-title">
        <h2 className="lead-title is-long" id="mt-title">Первая встреча с руководителем</h2>
        {meeting?.heldOn ? <p className="lead-sub">{dayLabel(meeting.heldOn)}</p> : null}
        {tasks.length > 0 ? (
          <div className="dn-fs">
            <h3>Подготовка</h3>
            <TaskChecks tasks={tasks} onToggle={actions.toggleTask} />
          </div>
        ) : null}
        {editing ? (
          <MeetingForm meeting={meeting ?? BLANK} onSave={save} onCancel={meeting ? () => setEditing(false) : null} />
        ) : (
          <>
            <Facts meeting={meeting!} onEdit={() => setEditing(true)} />
            <ActionDock
              kind="commit"
              primary={
                <Link className="btn is-primary" to={buildNodePath('d02k')}>
                  <Icon name="target" />
                  Сделать цели и KPI
                </Link>
              }
            />
          </>
        )}
      </section>
    </>
  );
}

function ManagerCard({ manager }: { readonly manager: string }) {
  return (
    <section className="mod" aria-labelledby="mt-boss">
      <div className="eyebrow">Руководитель</div>
      <h3 className="mod-title" id="mt-boss">{manager}</h3>
      <div className="actions">
        <Link className="btn is-quiet" to={buildNodePath('d01d')}>
          <Icon name="users" />
          Карта людей
        </Link>
      </div>
    </section>
  );
}

/** Экран d01c: подготовка к первой встрече с руководителем и её итоги. */
export function MeetingScreen({ node }: { readonly node: B640Node }) {
  return (
    <AdaptationGate
      node={node}
      aside={(data) => (data.view.firstMeeting?.manager ? <ManagerCard manager={data.view.firstMeeting.manager} /> : null)}
    >
      {(data, actions) => <MeetingBody data={data} actions={actions} />}
    </AdaptationGate>
  );
}
