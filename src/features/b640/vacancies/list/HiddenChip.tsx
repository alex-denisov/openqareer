import { Icon } from '../../kit';

export interface HiddenChipProps {
  readonly showHidden: boolean;
  readonly onShowHidden: (value: boolean) => void;
}

/** Чип «Показать скрытые» в подвале поповера фильтров и в листе 390. */
export function HiddenChip({ showHidden, onShowHidden }: HiddenChipProps) {
  return (
    <div className="vt-hid-line">
      <button className="chip vt-hid-chip" type="button" aria-pressed={showHidden} onClick={() => onShowHidden(!showHidden)}>
        <Icon name="eyeoff" />
        Показать скрытые
      </button>
    </div>
  );
}
