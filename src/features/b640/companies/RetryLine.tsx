import { StatusLine } from '../kit';

/** Ошибка на месте действия с «Повторить». */
export function RetryLine({ text, onRetry }: { readonly text: string; readonly onRetry: () => void }) {
  return (
    <StatusLine
      state="err"
      text={text}
      action={
        <button className="btn is-sm" type="button" onClick={onRetry}>
          Повторить
        </button>
      }
    />
  );
}
