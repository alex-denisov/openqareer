import { Fragment, useEffect, useRef } from 'react';
import { GOAL_INDICATORS_MAX } from '../../../../shared/careerDiaryCards';
import { Icon } from '../kit/Icon';
import { BaselineSuggestion, useBaselineHints, type RowHint } from './BaselineHint';
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
  readonly hint: RowHint | undefined;
  readonly onItem: (index: number, patch: Partial<IndicatorDraft>) => void;
  readonly onTitleDone: (index: number) => void;
}

function IndicatorRow({ index, item, hint, onItem, onTitleDone }: RowProps) {
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
          onBlur={() => onTitleDone(index)}
        />
      </div>
      <div className="gb-f gb-n2">
        <label htmlFor={`${id}-now`}>Сейчас</label>
        <input
          id={`${id}-now`}
          className={hint ? 'num is-draft' : 'num'}
          type="text"
          inputMode="decimal"
          aria-describedby={hint ? `${id}-sg` : undefined}
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

type Replace = (
  indicators: readonly IndicatorDraft[],
  index: number,
  next: (item: IndicatorDraft) => IndicatorDraft,
) => void;

/** Правка строк показателей и подсказка «Сейчас» из записей (B744). */
function useIndicatorRows(
  draft: GoalDraft,
  editing: boolean,
  onChange: IndicatorFieldsProps['onChange'],
) {
  // Ответ о значении приходит позже правок: заполняем по последней форме, а не по снимку.
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);
  const replaceIn: Replace = (indicators, index, next) =>
    onChange({ indicators: indicators.map((item, at) => (at === index ? next(item) : item)) });
  // Значение из записей — только для новой цели: у сохранённой «Сейчас» уже внесено.
  const baseline = useBaselineHints(!editing, (index, now, title) => {
    const row = latest.current.indicators[index];
    if (!row || (title !== undefined && (row.title.trim() !== title || row.now.trim() !== ''))) {
      return false;
    }
    replaceIn(latest.current.indicators, index, (item) => ({ ...item, now }));
    return true;
  });
  const onItem = (index: number, patch: Partial<IndicatorDraft>) =>
    replaceIn(draft.indicators, index, (item) => baseline.edited(index, { ...item, ...patch }));
  const onTitleDone = (index: number) => {
    const item = draft.indicators[index];
    if (item) baseline.look(index, item);
  };
  return { baseline, onItem, onTitleDone };
}

/** «Показатели · 1 из 3»: название, значение сейчас и цель; «+ Показатель». */
export function IndicatorFields({ draft, editing, error, onChange }: IndicatorFieldsProps) {
  const { baseline, onItem, onTitleDone } = useIndicatorRows(draft, editing, onChange);
  return (
    <fieldset className="gb-inds">
      <legend>{`Показатели · ${draft.indicators.length} из ${GOAL_INDICATORS_MAX}`}</legend>
      {draft.indicators.map((item, index) => {
        const hint = baseline.hints.get(index);
        return (
          <Fragment key={item.id ?? `new-${index}`}>
            <IndicatorRow
              index={index}
              item={item}
              hint={hint}
              onItem={onItem}
              onTitleDone={onTitleDone}
            />
            {hint ? (
              <BaselineSuggestion
                id={`gb-${index}-sg`}
                hint={hint}
                onAccept={() => baseline.accept(index)}
                onReject={() => baseline.reject(index)}
              />
            ) : null}
          </Fragment>
        );
      })}
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
