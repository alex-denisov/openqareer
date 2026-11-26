export interface SegOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegControlProps<T extends string> {
  readonly label: string;
  readonly name: string;
  readonly value: T;
  readonly options: readonly SegOption<T>[];
  readonly onChange: (value: T) => void;
  /** Дополнительный класс макета, например `sec-seg`. */
  readonly variant?: string;
}

/** Сегменты `div.seg-ctl[role=radiogroup]` из макета. */
export function SegControl<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  variant,
}: SegControlProps<T>) {
  return (
    <div
      className={variant ? `seg-ctl ${variant}` : 'seg-ctl'}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
