import { useState } from 'react';
import {
  PEOPLE_CADENCES,
  type CareerDiaryPeopleCadence,
  type CareerDiaryPersonInput,
  type CareerDiaryPersonView,
} from '../../../../shared/careerDiaryPeople';
import { Button } from '../kit/Button';
import { Dialog } from '../kit/Dialog';
import { StatusLine } from '../kit/ResultLine';
import { peopleCount } from './adaptationModel';
import { Field } from './StartPlan';

export const CADENCE: Readonly<Record<CareerDiaryPeopleCadence, string>> = {
  weekly: 'раз в неделю',
  biweekly: 'раз в 2 недели',
  monthly: 'раз в месяц',
  on_demand: 'по запросу',
};
const GROUPS = ['Руководитель', 'Команда', 'Соседние команды'];
const BLANK: CareerDiaryPersonInput = { name: '', role: '', group: 'Команда', cadence: 'biweekly', headcount: 1, lastMetOn: null };

/** Ожидание, ошибка и закрытие окна вокруг сохранения. */
function useSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return { busy, failed, run };
}

function CadenceSelect({ value, onChange }: { readonly value: CareerDiaryPeopleCadence; readonly onChange: (value: CareerDiaryPeopleCadence) => void }) {
  return (
    <div className="gb-f">
      <label htmlFor="pp-cadence">Как часто встречаться</label>
      <select id="pp-cadence" value={value} onChange={(event) => onChange(event.currentTarget.value as CareerDiaryPeopleCadence)}>
        {PEOPLE_CADENCES.map((cadence) => (
          <option key={cadence} value={cadence}>{CADENCE[cadence]}</option>
        ))}
      </select>
    </div>
  );
}

function PersonFields({ draft, set, groups, error }: {
  readonly draft: CareerDiaryPersonInput;
  readonly set: (patch: Partial<CareerDiaryPersonInput>) => void;
  readonly groups: readonly string[];
  readonly error?: string;
}) {
  return (
    <>
      <Field id="pp-name" label="Имя" value={draft.name} placeholder="Например: Илья" error={error} onChange={(name) => set({ name })} />
      <Field id="pp-role" label="Роль" value={draft.role} placeholder="Например: ведущий разработчик" onChange={(role) => set({ role })} />
      <div className="gb-f">
        <label htmlFor="pp-group">Группа</label>
        <input id="pp-group" list="pp-groups" maxLength={80} value={draft.group} onChange={(event) => set({ group: event.currentTarget.value })} />
        <datalist id="pp-groups">
          {[...new Set([...GROUPS, ...groups])].map((group) => <option key={group} value={group} />)}
        </datalist>
      </div>
      <CadenceSelect value={draft.cadence} onChange={(cadence) => set({ cadence })} />
      <Field id="pp-count" label="Сколько человек" value={String(draft.headcount)} onChange={(value) => set({ headcount: Math.max(1, Math.min(500, Number(value.replace(/\D/gu, '')) || 1)) })} />
      <Field id="pp-met" label="Последняя встреча" type="date" value={draft.lastMetOn ?? ''} onChange={(value) => set({ lastMetOn: value || null })} />
    </>
  );
}

function inputOf(person: CareerDiaryPersonView | null): CareerDiaryPersonInput {
  if (!person) return BLANK;
  const { name, role, group, cadence, headcount, lastMetOn } = person;
  return { name, role, group, cadence, headcount, lastMetOn };
}

/** Добавить или изменить человека; у изменения — удаление с подтверждением. */
export function PersonDialog({ person, groups, onClose, onSave, onRemove }: {
  readonly person: CareerDiaryPersonView | null;
  readonly groups: readonly string[];
  readonly onClose: () => void;
  readonly onSave: (input: CareerDiaryPersonInput) => Promise<void>;
  readonly onRemove: (() => Promise<void>) | null;
}) {
  const [draft, setDraft] = useState(() => inputOf(person));
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState(false);
  const { busy, failed, run } = useSave(onClose);
  const set = (patch: Partial<CareerDiaryPersonInput>) => setDraft({ ...draft, ...patch });
  function save() {
    const named = draft.headcount > 1 || draft.name.trim() || draft.role.trim();
    setError(named ? undefined : 'Напишите имя или роль');
    if (named && draft.group.trim()) void run(() => onSave({ ...draft, group: draft.group.trim() }));
  }
  const footer = confirm && onRemove ? (
    <>
      <Button variant="primary" icon="trash" busy={busy} onClick={() => void run(onRemove)}>Удалить</Button>
      <Button onClick={() => setConfirm(false)}>Отмена</Button>
    </>
  ) : (
    <>
      <Button variant="primary" icon="check" busy={busy} onClick={save}>Сохранить</Button>
      {onRemove ? <Button icon="trash" onClick={() => setConfirm(true)}>Удалить</Button> : <Button onClick={onClose}>Отмена</Button>}
    </>
  );
  return (
    <Dialog open onClose={onClose} title={person ? 'Человек на карте' : 'Новый человек'} footer={footer}>
      {confirm ? <p>Удалить с карты? Назначенная встреча уйдёт из плана.</p> : <PersonFields draft={draft} set={set} groups={groups} error={error} />}
      {failed ? <StatusLine state="err" text="Не сохранилось, попробуйте ещё раз" /> : null}
    </Dialog>
  );
}

export function personName(person: CareerDiaryPersonView): string {
  return person.name || person.role || `Ещё ${peopleCount(person.headcount)}`;
}

/** «Назначить встречу»: кому и когда; встреча попадает в план. */
export function MeetingDialog({ people, chosen, onClose, onSave }: {
  readonly people: readonly CareerDiaryPersonView[];
  readonly chosen: string | null;
  readonly onClose: () => void;
  readonly onSave: (personId: string, date: string, topic: string) => Promise<void>;
}) {
  const [personId, setPersonId] = useState(chosen ?? people[0]?.id ?? '');
  const meeting = people.find((person) => person.id === chosen)?.meeting;
  const [date, setDate] = useState(meeting?.date ?? '');
  const [topic, setTopic] = useState(meeting?.topic ?? '');
  const [error, setError] = useState<string | undefined>();
  const { busy, failed, run } = useSave(onClose);
  function save() {
    setError(date ? undefined : 'Укажите день');
    if (date && personId) void run(() => onSave(personId, date, topic));
  }
  const footer = (
    <>
      <Button variant="primary" icon="calendar" busy={busy} onClick={save}>Назначить</Button>
      <Button onClick={onClose}>Отмена</Button>
    </>
  );
  return (
    <Dialog open onClose={onClose} title="Назначить встречу" footer={footer}>
      <div className="gb-f">
        <label htmlFor="mt-person">С кем</label>
        <select id="mt-person" value={personId} onChange={(event) => setPersonId(event.currentTarget.value)}>
          {people.map((person) => <option key={person.id} value={person.id}>{personName(person)}</option>)}
        </select>
      </div>
      <Field id="mt-date" label="Когда" type="date" value={date} error={error} onChange={setDate} />
      <Field id="mt-topic" label="Тема" value={topic} placeholder="Например: цели года" onChange={setTopic} />
      {failed ? <StatusLine state="err" text="Встреча не назначилась, попробуйте ещё раз" /> : null}
    </Dialog>
  );
}
