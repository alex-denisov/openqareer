import { GOAL_INDICATORS_MAX } from '../../../../shared/careerDiaryCards';
import { Icon } from '../kit/Icon';
import { EMPTY_INDICATOR, canAddIndicator, type GoalDraft, type IndicatorDraft } from './goalForm';

export interface IndicatorFieldsProps {
  readonly draft: GoalDraft;
  /** Правка цели: новые показатели добавляются только к новой цели. */
  readonly editing: boolean;
  readonly error?: string;
  readonly onChange: (patch: Partial<GoalDraft>) => void;
}

interface RowProps {
  readonly index: number;
  readonly item: IndicatorDraft;
  readonly onItem: (index: number, patch: Partial<IndicatorDraft>) => void;
}

function IndicatorRow({ index, item, onItem }: RowProps) {
  const id = `gb-${index}`;
  return (
    <div className="gb-ind">
      <div className="gb-f gb-i">
        <label htmlFor={`${id}-i`}>Показатель</label>
        <input
          id={`${id}-i`}
          type="text"
          maxLength={240}
          placeholder="Например: время до первого ревью, часов"
          value={item.title}
          onChange={(event) => onItem(index, { title: event.target.value })}
        />
      </div>
      <div className="gb-f gb-n2">
        <label htmlFor={`${id}-now`}>Сейчас</label>
        <input
          id={`${id}-now`}
          className="num"
          type="text"
          inputMode="decimal"
          value={item.now}
          onChange={(event) => onItem(index, { now: event.target.value })}
        />
      </div>
      <div className="gb-f gb-n2">
        <label htmlFor={`${id}-tg`}>Цель</label>
        <input
          id={`${id}-tg`}
          className="num"
          type="text"
          inputMode="decimal"
          value={item.target}
          onChange={(event) => onItem(index, { target: event.target.value })}
        />
      </div>
    </div>
  );
}

/** «Показатели · 1 из 3»: название, значение сейчас и цель; «+ Показатель». */
export function IndicatorFields({ draft, editing, error, onChange }: IndicatorFieldsProps) {
  const onItem = (index: number, patch: Partial<IndicatorDraft>) =>
    onChange({
      indicators: draft.indicators.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    });
  return (
    <fieldset className="gb-inds">
      <legend>{`Показатели · ${draft.indicators.length} из ${GOAL_INDICATORS_MAX}`}</legend>
      {draft.indicators.map((item, index) => (
        <IndicatorRow key={item.id ?? `new-${index}`} index={index} item={item} onItem={onItem} />
      ))}
      {error ? (
        <p className="va-err" role="alert">
          {error}
        </p>
      ) : null}
      {!editing && canAddIndicator(draft) ? (
        <button
          className="btn is-quiet is-sm gb-add"
          type="button"
          onClick={() => onChange({ indicators: [...draft.indicators, EMPTY_INDICATOR] })}
        >
          <Icon name="plus" />
          Показатель
        </button>
      ) : null}
    </fieldset>
  );
}
