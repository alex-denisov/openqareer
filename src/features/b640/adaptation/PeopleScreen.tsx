import { useState } from 'react';
import type {
  CareerDiaryPeopleMap,
  CareerDiaryPersonInput,
  CareerDiaryPersonView,
} from '../../../../shared/careerDiaryPeople';
import { ActionDock } from '../kit/ActionDock';
import { Button } from '../kit/Button';
import { Icon } from '../kit/Icon';
import type { B640Node } from '../routes';
import { addPerson, removePerson, scheduleMeeting, updatePerson } from './adaptationApi';
import { dayLabel, peopleCount } from './adaptationModel';
import { AdaptationGate } from './AdaptationGate';
import { CADENCE, MeetingDialog, PersonDialog, personName } from './PeopleDialogs';
import type { AdaptationData } from './useAdaptation';

const PAGE = 20;
type Open = { kind: 'person'; person: CareerDiaryPersonView | null } | { kind: 'meeting'; personId: string | null } | null;

function personSub(person: CareerDiaryPersonView): string {
  const met = person.lastMetOn ? dayLabel(person.lastMetOn) : 'не встречались';
  return [person.name ? person.role : '', CADENCE[person.cadence], met].filter(Boolean).join(' · ');
}

function PersonRow({ person, onEdit, onMove }: {
  readonly person: CareerDiaryPersonView;
  readonly onEdit: () => void;
  readonly onMove: () => void;
}) {
  return (
    <li className="row">
      <div>
        <div className="row-title">{personName(person)}</div>
        <div className="row-sub">{personSub(person)}</div>
      </div>
      <span className="ap-row-end">
        {person.status === 'scheduled' && person.meeting ? (
          <button className="row-act" type="button" onClick={onMove}>
            {`Встреча ${dayLabel(person.meeting.date)} · Перенести`}
          </button>
        ) : null}
        {person.status === 'none' ? <span className="tag part">без встречи</span> : null}
        <button className="icon-btn" type="button" aria-label={`Изменить: ${personName(person)}`} onClick={onEdit}>
          <Icon name="edit" />
        </button>
      </span>
    </li>
  );
}

function Groups({ map, limit, setOpen }: {
  readonly map: CareerDiaryPeopleMap;
  readonly limit: number;
  readonly setOpen: (open: Open) => void;
}) {
  let left = limit;
  return (
    <>
      {map.groups.map((group) => {
        const shown = group.people.slice(0, Math.max(0, left));
        left -= shown.length;
        if (shown.length === 0) return null;
        const count = group.headcount > 1 ? ` · ${group.headcount}` : '';
        return (
          <section className="mod" key={group.name} aria-label={group.name}>
            <h3 className="mod-title">{`${group.name}${count}`}</h3>
            <ul className="rows">
              {shown.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  onEdit={() => setOpen({ kind: 'person', person })}
                  onMove={() => setOpen({ kind: 'meeting', personId: person.id })}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function PeopleBody({ data }: { readonly data: AdaptationData }) {
  const id = data.workplace.id;
  const [map, setMap] = useState<CareerDiaryPeopleMap | null>(data.people);
  const [open, setOpen] = useState<Open>(null);
  const [limit, setLimit] = useState(PAGE);
  const people = map?.groups.flatMap((group) => group.people) ?? [];
  const save = (person: CareerDiaryPersonView | null) => async (input: CareerDiaryPersonInput) =>
    setMap(await (person ? updatePerson(id, person.id, input) : addPerson(id, input)));
  const next = map?.nextMeeting ? people.find((person) => person.id === map.nextMeeting!.personId) : undefined;
  return (
    <>
      <section className="lead" aria-labelledby="pm-title">
        <h2 className="lead-title is-long" id="pm-title">Карта людей: с кем и как часто</h2>
        <p className="lead-sub">{map && map.total > 0 ? `${peopleCount(map.total)} · ${map.withoutMeeting} без встречи` : 'На карте пока никого'}</p>
        {next && map?.nextMeeting ? (
          <p className="lead-text">{`Встреча: ${personName(next)} · ${dayLabel(map.nextMeeting.date)}`}</p>
        ) : null}
        <ActionDock
          kind="commit"
          primary={
            people.length > 0 ? (
              <Button variant="primary" icon="calendar" onClick={() => setOpen({ kind: 'meeting', personId: null })}>Назначить встречу</Button>
            ) : (
              <Button variant="primary" icon="plus" onClick={() => setOpen({ kind: 'person', person: null })}>Добавить человека</Button>
            )
          }
          secondary={people.length > 0 ? <Button icon="plus" onClick={() => setOpen({ kind: 'person', person: null })}>Добавить человека</Button> : undefined}
        />
      </section>
      {map ? <Groups map={map} limit={limit} setOpen={setOpen} /> : null}
      {people.length > limit ? (
        <button className="btn" type="button" onClick={() => setLimit(limit + PAGE)}>Показать ещё</button>
      ) : null}
      {open?.kind === 'person' ? (
        <PersonDialog
          person={open.person}
          groups={map?.groups.map((group) => group.name) ?? []}
          onClose={() => setOpen(null)}
          onSave={save(open.person)}
          onRemove={open.person ? async () => setMap(await removePerson(id, open.person!.id)) : null}
        />
      ) : null}
      {open?.kind === 'meeting' ? (
        <MeetingDialog people={people} chosen={open.personId} onClose={() => setOpen(null)} onSave={async (personId, date, topic) => setMap(await scheduleMeeting(id, personId, date, topic))} />
      ) : null}
    </>
  );
}

/** Экран d01d «Карта людей»: с кем и как часто встречаться, встречи уходят в план. */
export function PeopleScreen({ node }: { readonly node: B640Node }) {
  return <AdaptationGate node={node}>{(data) => <PeopleBody data={data} />}</AdaptationGate>;
}
