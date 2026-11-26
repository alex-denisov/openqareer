import type { ReactNode } from 'react';

export interface SettingsGroupProps {
  readonly title: string;
  readonly children: ReactNode;
}

/** `section.set-group > h3.set-h + ul.set-list`. */
export function SettingsGroup({ title, children }: SettingsGroupProps) {
  return (
    <section className="set-group">
      <h3 className="set-h">{title}</h3>
      <ul className="set-list">{children}</ul>
    </section>
  );
}

export interface SettingsRowProps {
  readonly title: string;
  readonly id?: string;
  readonly value?: string;
  /** Правая часть строки: переключатель, кнопка, меню. */
  readonly end?: ReactNode;
}

/** `li.set-row > .set-l(.set-t, .set-v) + .set-r`. */
export function SettingsRow({ title, id, value, end }: SettingsRowProps) {
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t" id={id}>
          {title}
        </span>
        {value ? <span className="set-v">{value}</span> : null}
      </div>
      {end ? <div className="set-r">{end}</div> : null}
    </li>
  );
}

export interface SwitchProps {
  /** id подписи (`.set-t`): переключатель читается по ней. */
  readonly labelledBy: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}

/** `span.sw-cell > input.sw[type=checkbox][role=switch]`. */
export function Switch({ labelledBy, checked, onChange, disabled }: SwitchProps) {
  return (
    <span className="sw-cell">
      <input
        className="sw"
        type="checkbox"
        role="switch"
        aria-labelledby={labelledBy}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </span>
  );
}
