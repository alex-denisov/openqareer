import { useId, useState } from 'react';

export interface ToggleList {
  readonly items: readonly string[];
  /** Отмеченные значения в порядке списка: их и сохраняет правка. */
  readonly checked: readonly string[];
  readonly isOn: (item: string) => boolean;
  readonly toggle: (item: string) => void;
  /** Новое значение встаёт в список отмеченным; повтор только отмечает прежнее. */
  readonly add: (item: string) => void;
}

/** Список галочек правки: снятая галочка остаётся видна до «Сохранить» и возвращается одним нажатием. */
export function useToggleList(initial: readonly string[]): ToggleList {
  const [items, setItems] = useState(initial);
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const without = (set: ReadonlySet<string>, item: string) =>
    new Set([...set].filter((entry) => entry !== item));
  return {
    items,
    checked: items.filter((item) => !off.has(item)),
    isOn: (item) => !off.has(item),
    toggle: (item) =>
      setOff((set) => (set.has(item) ? without(set, item) : new Set([...set, item]))),
    add: (item) => {
      const same = (entry: string) =>
        entry.toLocaleLowerCase('ru') === item.toLocaleLowerCase('ru');
      const existing = items.find(same) ?? item;
      setItems((list) => (list.some(same) ? list : [...list, item]));
      setOff((set) => without(set, existing));
    },
  };
}

export function ToggleChecks({ list }: { readonly list: ToggleList }) {
  const id = useId();
  return (
    <>
      {list.items.map((item, index) => (
        <div className="check" key={item}>
          <input
            id={`${id}-${index}`}
            type="checkbox"
            checked={list.isOn(item)}
            onChange={() => list.toggle(item)}
          />
          <label htmlFor={`${id}-${index}`}>{item}</label>
        </div>
      ))}
    </>
  );
}
