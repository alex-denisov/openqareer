import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'default' | 'primary' | 'quiet' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant?: ButtonVariant;
  readonly size?: 'md' | 'sm';
  readonly icon?: IconName;
  /** Ожидание на месте действия: кнопка занята и недоступна. */
  readonly busy?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: '',
  primary: 'is-primary',
  quiet: 'is-quiet',
  danger: 'is-danger',
};

export function buttonClass(variant: ButtonVariant, size: 'md' | 'sm'): string {
  return ['btn', VARIANT_CLASS[variant], size === 'sm' ? 'is-sm' : ''].filter(Boolean).join(' ');
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  busy = false,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass(variant, size)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {icon ? <Icon name={busy ? 'hourglass' : icon} /> : null}
      {children}
    </button>
  );
}
