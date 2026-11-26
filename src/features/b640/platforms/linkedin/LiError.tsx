import { Icon } from '../../kit';

/** Ошибка действия с черновиком на месте, с «Повторить» (a03b). */
export function LiError({
  text,
  onRetry,
}: {
  readonly text: string;
  /** Нет — повтор ничего не даст: варианты кончились. */
  readonly onRetry?: () => void;
}) {
  return (
    <p className="li-err" role="alert">
      <Icon name="warn" />
      {text}
      {onRetry ? (
        <button className="row-act" type="button" onClick={onRetry}>
          <Icon name="repeat" />
          Повторить
        </button>
      ) : null}
    </p>
  );
}
