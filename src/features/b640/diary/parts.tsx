import { Icon } from '../kit/Icon';

/** «Повторить» в строке ошибки на месте действия. */
export function RetryButton({
  onClick,
  submit = false,
}: {
  readonly onClick?: () => void;
  readonly submit?: boolean;
}) {
  return (
    <button className="btn is-sm" type={submit ? 'submit' : 'button'} onClick={onClick}>
      <Icon name="repeat" />
      Повторить
    </button>
  );
}
