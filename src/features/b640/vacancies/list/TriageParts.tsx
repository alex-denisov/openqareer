import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { pluralRu } from '../format';
import type { CurrentQuestion } from './triageModel';

/** Признак режима «Помочь выбрать» в адресе подборки (v09 — состояние s07). */
export const REVIEW_PARAM = 'mode=review';

function reviewPath(): string {
  return `${buildNodePath('s07')}?${REVIEW_PARAM}`;
}

/** «Помочь выбрать»: ссылка на режим списка v09 (состояние узла s07); нажатие включает режим на месте. */
export function ReviewButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <Link
      className="btn va-review"
      to={reviewPath()}
      aria-current={active ? 'true' : undefined}
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
    >
      <Icon name="chat" />
      Помочь выбрать
    </Link>
  );
}

/** Один вопрос разбора: «k из N», текст, «Да» и «Нет». */
export function TriageQuestion({
  question,
  onAnswer,
}: {
  question: CurrentQuestion;
  onAnswer: (value: boolean) => void;
}) {
  return (
    <div className="vz-q1" role="group" aria-labelledby="vz-q1-t">
      <p className="vz-q1-t" id="vz-q1-t">
        <span className="vz-q1-n num">
          {question.number} из {question.total}
        </span>
        {question.text}
      </p>
      <div className="vz-q1-a">
        <button className="btn is-sm" type="button" onClick={() => onAnswer(true)}>
          Да
        </button>
        <button className="btn is-sm" type="button" onClick={() => onAnswer(false)}>
          Нет
        </button>
      </div>
    </div>
  );
}

/** Полоса режима: «Скрыть выбранные · N» и «Отмена». На 390 стили макета закрепляют её внизу. */
export function TriageBar({
  count,
  busy,
  loading = false,
  onHide,
  onCancel,
}: {
  count: number;
  busy: boolean;
  /** Идёт повторный разбор: число и отметки ещё прежние, скрывать по ним нельзя. */
  loading?: boolean;
  onHide: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="vz-bar" role="group" aria-label="Помочь выбрать">
      {count > 0 ? (
        <button
          className="btn is-primary"
          type="button"
          disabled={busy || loading}
          aria-busy={busy || undefined}
          onClick={onHide}
        >
          Скрыть выбранные · <span className="num">{count}</span>
        </button>
      ) : null}
      <button className="btn" type="button" disabled={busy} onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}

export type TriageStatusProps =
  | { readonly kind: 'loading'; readonly total: number }
  | { readonly kind: 'weak'; readonly keep: number; readonly total: number }
  /** Итог разбора, в котором скрывать нечего: режим уже закрыт, строка стоит на его месте. */
  | { readonly kind: 'nothing'; readonly total: number; readonly pool?: number }
  /** Подборка больше потолка разбора: разобраны первые `total` из `pool`. */
  | { readonly kind: 'capped'; readonly total: number; readonly pool: number };

export function TriageStatus(props: TriageStatusProps) {
  if (props.kind === 'loading') {
    const word = pluralRu(props.total, 'вакансию', 'вакансии', 'вакансий');
    return (
      <p className="vz-st" role="status" aria-busy="true">
        <Icon name="hourglass" />
        Разбираем <span className="num">{props.total}</span> {word}…
      </p>
    );
  }
  if (props.kind === 'capped' || (props.kind === 'nothing' && props.pool !== undefined)) {
    const pool = props.pool ?? props.total;
    return (
      <p className="vz-st" role="status">
        {props.kind === 'nothing' ? 'Скрывать нечего: разобраны' : 'Разобраны'} первые{' '}
        <span className="num">{props.total}</span> из <span className="num">{pool}</span>{' '}
        {pluralRu(pool, 'вакансии', 'вакансий', 'вакансий')}
      </p>
    );
  }
  if (props.kind === 'nothing') {
    return (
      <p className="vz-st" role="status">
        {props.total === 1 ? (
          'Скрывать нечего: вакансия подходит'
        ) : (
          <>
            Скрывать нечего: все <span className="num">{props.total}</span>{' '}
            {pluralRu(props.total, 'вакансия', 'вакансии', 'вакансий')} подходят
          </>
        )}
      </p>
    );
  }
  return (
    <p className="vz-st" role="status">
      Подборка слабо совпадает · подходит <span className="num">{props.keep}</span> из{' '}
      <span className="num">{props.total}</span>
    </p>
  );
}

/** Сбой разбора или скрытия: строка с «Повторить» на месте, режим остаётся открытым. */
export function TriageError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="vl-err" role="alert">
      <Icon name="warn" />
      <span>{text}</span>
      <button className="row-act" type="button" onClick={onRetry}>
        <Icon name="refresh" />
        Повторить
      </button>
    </div>
  );
}
