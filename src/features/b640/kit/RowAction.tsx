import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface RowActionBase {
  readonly icon?: IconName;
  readonly small?: boolean;
  readonly danger?: boolean;
  readonly neutral?: boolean;
  readonly children: ReactNode;
}

export type RowActionProps = RowActionBase &
  (
    | (Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
        href?: undefined;
      })
    | (Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'> & { href: string })
  );

function rowActClass({ small, danger, neutral }: RowActionBase): string {
  return ['row-act', small && 'is-sm', danger && 'is-danger', neutral && 'is-neutral']
    .filter(Boolean)
    .join(' ');
}

/** Действие в строке: ссылка (с `href`) или кнопка, значок слева. */
export function RowAction(props: RowActionProps) {
  const { icon, small, danger, neutral, children, ...rest } = props;
  const className = rowActClass({ small, danger, neutral, children });
  const content = (
    <>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </>
  );
  if (props.href !== undefined) {
    const anchor = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a {...anchor} className={className}>
        {content}
      </a>
    );
  }
  const button = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type="button" {...button} className={className}>
      {content}
    </button>
  );
}
