import type { ReactNode } from 'react';
import { CaretRight, type Icon } from '@phosphor-icons/react';

export function ProfileMobileRow({
  icon: Icon,
  title,
  detail,
  value,
  onClick,
  warning = false,
}: {
  readonly icon: Icon;
  readonly title: string;
  readonly detail?: string;
  readonly value?: ReactNode;
  readonly onClick?: () => void;
  readonly warning?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pm-row${warning ? ' is-warn' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="pm-ico">
        <Icon size="1em" aria-hidden="true" />
      </span>
      <span className="pm-main">
        <b>{title}</b>
        {detail ? <small>{detail}</small> : null}
      </span>
      {value !== undefined ? <span className="pm-val">{value}</span> : null}
      <CaretRight className="pm-chev" size="1em" aria-hidden="true" />
    </button>
  );
}

export function ProfileMobileGroup({
  title,
  foot,
  children,
}: {
  readonly title?: string;
  readonly foot?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="pm-group">
      {title ? <h3 className="pm-cap">{title}</h3> : null}
      <div className="pm-list">{children}</div>
      {foot ? <p className="pm-foot">{foot}</p> : null}
    </section>
  );
}

export function ProfileMobileKeyValue({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="pm-kv">
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

export function profileMobileDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}
