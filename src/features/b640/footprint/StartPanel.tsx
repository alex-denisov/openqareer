import { useMemo, useState } from 'react';
import { Button, InfoTip, StatusLine } from '../kit';
import {
  auditProgress,
  defaultSelection,
  failedChecks,
  planGroups,
  searchByLine,
  selectedIds,
  type PlanGroup,
} from './footprintModel';
import type { FootprintData } from './useFootprint';
import { repeatIds, useStartSearch } from './useStartSearch';

interface StartPanelProps {
  readonly data: FootprintData;
  readonly onStarted: () => void;
}

/** Полоса ожидания (F2) и строка «не всё проверили» с «Повторить» (F2б) — у кнопки поиска. */
export function SearchState({ data, onStarted }: StartPanelProps) {
  const repeat = useStartSearch(data, onStarted);
  if (data.summary.state === 'checking') {
    const { done, total } = auditProgress(data.audit);
    return (
      <progress className="pf-prog" aria-label="Проверено" max={total} value={done}>
        {done} из {total}
      </progress>
    );
  }
  const failed = failedChecks(data.audit);
  if (failed === 0 && !repeat.error) return null;
  return (
    <StatusLine
      state="err"
      text={repeat.error ?? 'Проверили не всё'}
      action={
        <Button variant="primary" size="sm" icon="repeat" busy={repeat.busy}
          onClick={() => void repeat.start(repeatIds(data))}>
          Повторить
        </Button>
      }
    />
  );
}

interface FieldsProps {
  readonly groups: readonly PlanGroup[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
}

/** F1в «Данные для поиска»: отмечаем, по чему искать. */
function SearchFields({ groups, selected, onToggle }: FieldsProps) {
  return (
    <div className="fp-fields" role="group" aria-label="Данные для поиска">
      {groups.map((group, index) => (
        <div className="check" key={group.key}>
          <input
            id={`fp-q-${index}`}
            type="checkbox"
            checked={selected.has(group.key)}
            onChange={() => onToggle(group.key)}
          />
          <label htmlFor={`fp-q-${index}`}>{group.label}</label>
        </div>
      ))}
    </div>
  );
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** F1: что ищем, согласие и «Начать поиск». Без галочки согласия кнопка недоступна (F1б). */
export function StartPanel({ data, onStarted }: StartPanelProps) {
  const groups = useMemo(() => planGroups(data.plan), [data.plan]);
  const [selected, setSelected] = useState(() => defaultSelection(data.plan));
  const [editing, setEditing] = useState(false);
  const [agreed, setAgreed] = useState(data.consentGranted);
  const search = useStartSearch(data, onStarted);
  const checking = data.summary.state === 'checking';
  const line = searchByLine(groups, selected);

  return (
    <section className="lead" aria-labelledby="pf-t">
      <h2 className="lead-title is-long" id="pf-t">Что увидит работодатель</h2>
      <p className="fp-by">
        <span>{line ? `Ищем по: ${line}` : 'Данные для поиска не отмечены'}</span>
        <button className="row-act" type="button" aria-expanded={editing}
          onClick={() => setEditing((open) => !open)}>
          {editing ? 'Свернуть' : 'Изменить'}
        </button>
      </p>
      {editing ? (
        <SearchFields groups={groups} selected={selected}
          onToggle={(key) => setSelected((set) => toggled(set, key))} />
      ) : null}
      <div className="fp-consent">
        <div className="check">
          <input id="fp-consent" type="checkbox" checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)} />
          <label htmlFor="fp-consent">Разрешаю проверить, что обо мне видно в открытом доступе</label>
          <InfoTip label="Что ищем и что не делаем"
            text="Ищем только по данным, которые вы отметили. Не пишем от вашего имени." />
        </div>
      </div>
      <SearchState data={data} onStarted={onStarted} />
      {search.error ? <StatusLine state="err" text={search.error} /> : null}
      <div className="actions fp-go">
        <Button variant="primary" icon="search" busy={search.busy || checking}
          disabled={!agreed || checking}
          onClick={() => void search.start(selectedIds(groups, selected))}>
          Начать поиск
        </Button>
      </div>
    </section>
  );
}
