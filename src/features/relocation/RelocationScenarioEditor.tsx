import { useState } from 'react';
import { ArrowRight, CaretLeft, FloppyDisk } from '@phosphor-icons/react';
import type {
  RelocationScenarioInput,
  SavedRelocationScenario,
} from '../../../shared/relocationScenario';
import { getCountryTaxData } from '../../../shared/taxData';
import { SavedScenarioComparison } from './RelocationScenarioResult';
import {
  ScenarioBasics,
  ScenarioComparison,
  ScenarioExpenses,
  ScenarioFamilyFields,
  ScenarioPayroll,
  ScenarioUpfront,
  ScenarioVisa,
} from './RelocationScenarioFields';
import { relocationDay } from './relocationDates';
import type { RelocationScenarioState } from './useRelocationScenario';
import './relocation-scenarios.css';
import './relocation-economy.css';

export interface RelocationScenarioEditorProps {
  readonly scenario: RelocationScenarioState;
  readonly countryCode: RelocationScenarioInput['countryCode'];
  readonly onBack: () => void;
  /** «Рассчитать» succeeded: the calculation screen shows the saved result. */
  readonly onCalculated: () => void;
  /** A saved scenario was opened: its country and salary go back to the calculation screen. */
  readonly onOpened: (input: RelocationScenarioInput) => void;
  readonly mobile?: boolean;
}

/** The scenario editor of «Экономика»: typed fields, «Сбросить · Сохранить · Рассчитать», saved scenarios. */
export function RelocationScenarioEditor(props: RelocationScenarioEditorProps) {
  const { scenario, countryCode } = props;
  const currency = getCountryTaxData(countryCode).currency;
  const fields = { draft: scenario.draft, update: scenario.update, countryCode, currency };
  return (
    <section
      className="career-relocation-scenarios"
      aria-labelledby="career-relocation-scenario-title"
    >
      {props.mobile ? null : (
        <button
          className="career-relocation-btn is-sm is-ghost"
          type="button"
          onClick={props.onBack}
        >
          <CaretLeft aria-hidden="true" size={16} />К расчёту
        </button>
      )}
      <h3 id="career-relocation-scenario-title">Свой сценарий расходов</h3>
      <p className="career-relocation-scenario-hint">
        Суммы в {currency}, на всю семью. Пустое поле — сумма неизвестна; 0 — расхода точно нет.
        Взносы, уже вычтенные из зарплаты, повторно не добавляйте.
      </p>
      <ScenarioBasics {...fields} />
      <ScenarioFamilyFields draft={scenario.draft} update={scenario.update} />
      <ScenarioExpenses {...fields} />
      <ScenarioUpfront draft={scenario.draft} update={scenario.update} currency={currency} />
      <ScenarioVisa {...fields} />
      <ScenarioPayroll draft={scenario.draft} update={scenario.update} countryCode={countryCode} />
      <ScenarioComparison draft={scenario.draft} update={scenario.update} currency={currency} />
      <EditorActions {...props} />
      {scenario.error ? (
        <p className="career-relocation-error" role="alert">
          {scenario.error}
        </p>
      ) : null}
      {scenario.notice ? <p role="status">{scenario.notice}</p> : null}
      <SavedScenarios {...props} />
    </section>
  );
}

/** «Сбросить» left, «Сохранить» in the middle, «Рассчитать» right as the main action. */
function EditorActions({ scenario, onCalculated }: RelocationScenarioEditorProps) {
  return (
    <div className="career-relocation-scenario-actions">
      <button
        className="career-relocation-btn is-ghost"
        type="button"
        disabled={scenario.busy}
        onClick={scenario.reset}
      >
        Сбросить
      </button>
      <button
        className="career-relocation-btn"
        type="button"
        disabled={scenario.busy}
        onClick={() => void scenario.save()}
      >
        <FloppyDisk aria-hidden="true" size={17} />
        Сохранить
      </button>
      <button
        className="career-relocation-btn is-primary"
        type="button"
        disabled={scenario.busy}
        aria-busy={scenario.busy}
        onClick={() => void scenario.calculate().then((result) => result && onCalculated())}
      >
        <ArrowRight aria-hidden="true" size={17} />
        {scenario.busy ? 'Считаем…' : 'Рассчитать'}
      </button>
    </div>
  );
}

function SavedScenarios({ scenario, onOpened }: RelocationScenarioEditorProps) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  return (
    <section
      className="career-relocation-scenario-saved"
      aria-labelledby="career-relocation-saved-title"
    >
      <h3 id="career-relocation-saved-title">Сохранённые расчёты</h3>
      {scenario.saved.length === 0 ? (
        <p className="career-relocation-scenario-hint">Расчётов пока нет.</p>
      ) : (
        <ul>
          {scenario.saved.map((item) => (
            <SavedRow
              key={item.id}
              item={item}
              compared={selected.includes(item.id)}
              compareDisabled={!selected.includes(item.id) && selected.length >= 3}
              onCompare={(on) =>
                setSelected((old) => (on ? [...old, item.id] : old.filter((id) => id !== item.id)))
              }
              onOpen={() => onOpened(scenario.open(item))}
              onRemove={() => void scenario.remove(item.id)}
              busy={scenario.busy}
            />
          ))}
        </ul>
      )}
      {scenario.nextOffset !== null ? (
        <button
          className="career-relocation-btn is-ghost"
          type="button"
          onClick={scenario.loadMore}
        >
          Показать ещё
        </button>
      ) : null}
      {selected.length > 0 ? (
        <SavedScenarioComparison
          items={scenario.saved.filter((item) => selected.includes(item.id))}
        />
      ) : null}
    </section>
  );
}

function SavedRow({
  item,
  compared,
  compareDisabled,
  onCompare,
  onOpen,
  onRemove,
  busy,
}: {
  readonly item: SavedRelocationScenario;
  readonly compared: boolean;
  readonly compareDisabled: boolean;
  readonly onCompare: (on: boolean) => void;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
  readonly busy: boolean;
}) {
  return (
    <li>
      <div>
        <b>{item.input.name}</b>
        <small>
          {item.input.city} · {item.input.householdSize} чел. · {relocationDay(item.createdAt)}
        </small>
      </div>
      <label className="career-relocation-scenario-check">
        <input
          type="checkbox"
          checked={compared}
          aria-label={`В сравнение: ${item.input.name}`}
          disabled={compareDisabled}
          onChange={(e) => onCompare(e.target.checked)}
        />
        В сравнение
      </label>
      <button
        className="career-relocation-btn is-sm"
        type="button"
        aria-label={`Открыть: ${item.input.name}`}
        onClick={onOpen}
      >
        Открыть
      </button>
      <RemoveControl name={item.input.name} busy={busy} onRemove={onRemove} />
    </li>
  );
}

/** «Удалить» asks once more: «Оставить» or «Удалить». */
function RemoveControl({
  name,
  busy,
  onRemove,
}: {
  readonly name: string;
  readonly busy: boolean;
  readonly onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm)
    return (
      <button
        className="career-relocation-btn is-sm is-ghost"
        type="button"
        aria-label={`Удалить: ${name}`}
        onClick={() => setConfirm(true)}
      >
        Удалить
      </button>
    );
  return (
    <span role="group" aria-label={`Удалить «${name}»?`}>
      <button
        className="career-relocation-btn is-sm is-ghost"
        type="button"
        onClick={() => setConfirm(false)}
      >
        Оставить
      </button>
      <button
        className="career-relocation-btn is-sm is-danger"
        type="button"
        disabled={busy}
        onClick={onRemove}
      >
        Удалить
      </button>
    </span>
  );
}
