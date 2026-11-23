import { useRef, useState } from 'react';
import { InfoTip } from '../kit/InfoTip';
import { getGoalBaseline, type GoalBaseline } from './goalHintsApi';
import type { IndicatorDraft } from './goalForm';
import { longDate } from './model';

/**
 * B744 · d02b: значение «Сейчас» из записей кандидата. Когда кандидат вписал показатель и
 * оставил «Сейчас» пустым, платформа ищет значение в записях и кладёт его черновиком с
 * «Верно · Нет»; откуда оно — цитата записи в ⓘ.
 */
export interface RowHint extends GoalBaseline {
  /** Показатель, под который найдено значение: сменился — черновик снимается. */
  readonly title: string;
  readonly now: string;
}

const MIN_TITLE = 2;
const numberText = (value: number): string => String(value).replace('.', ',');
const key = (title: string): string => title.trim().toLowerCase();

export interface BaselineHints {
  readonly hints: ReadonlyMap<number, RowHint>;
  /** Название показателя дописано: спросить значение, если «Сейчас» пусто. */
  readonly look: (index: number, item: IndicatorDraft) => void;
  /** Правка строки: черновик снимается, если кандидат сменил показатель или значение. */
  readonly edited: (index: number, item: IndicatorDraft) => IndicatorDraft;
  readonly accept: (index: number) => void;
  /** «Нет»: черновик убирается, этот показатель больше не спрашиваем. */
  readonly reject: (index: number) => void;
}

export function useBaselineHints(
  enabled: boolean,
  /** Кладёт значение в «Сейчас»; `false` — строка уже другая (сменили показатель или вписали значение). */
  fill: (index: number, now: string, title?: string) => boolean,
): BaselineHints {
  const [hints, setHints] = useState<ReadonlyMap<number, RowHint>>(new Map());
  const asked = useRef(new Set<string>());
  const without = (index: number) =>
    setHints((previous) => new Map([...previous].filter(([at]) => at !== index)));

  const look = (index: number, item: IndicatorDraft) => {
    const title = item.title.trim();
    if (!enabled || item.now.trim() !== '' || title.length < MIN_TITLE) return;
    if (asked.current.has(key(title))) return;
    asked.current.add(key(title));
    getGoalBaseline(title).then(
      (found) => {
        if (!found) return;
        const now = numberText(found.value);
        if (!fill(index, now, title)) return;
        setHints((previous) => new Map(previous).set(index, { ...found, title, now }));
      },
      () => undefined,
    );
  };

  const edited = (index: number, item: IndicatorDraft): IndicatorDraft => {
    const hint = hints.get(index);
    if (!hint) return item;
    if (item.title.trim() === hint.title && item.now === hint.now) return item;
    without(index);
    // Сменили показатель, а значение осталось черновым — оно было про другой показатель.
    return item.title.trim() !== hint.title && item.now === hint.now ? { ...item, now: '' } : item;
  };

  // Пока черновик висит, «Сейчас» равно ему: любая правка значения уже сняла бы черновик.
  const reject = (index: number) => {
    if (!hints.has(index)) return;
    without(index);
    fill(index, '');
  };

  return { hints, look, edited, accept: without, reject };
}

interface SuggestionProps {
  readonly id: string;
  readonly hint: RowHint;
  readonly onAccept: () => void;
  readonly onReject: () => void;
}

/** Строка под показателем: «18 — из ваших записей ⓘ · Верно · Нет». */
export function BaselineSuggestion({ id, hint, onAccept, onReject }: SuggestionProps) {
  return (
    <div className="gb-sugg" id={id}>
      <span className="gb-sugg-t">{`${hint.now} — из ваших записей`}</span>
      <InfoTip
        label={`Откуда ${hint.now}`}
        text={`Из записи ${longDate(hint.entryDate)}: «${hint.quote}».`}
      />
      <button className="row-act is-sm" type="button" onClick={onAccept}>
        Верно
      </button>
      <button className="row-act is-sm" type="button" onClick={onReject}>
        Нет
      </button>
    </div>
  );
}
