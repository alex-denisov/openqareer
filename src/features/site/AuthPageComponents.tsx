import React, { useState } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';

export function AuthCardHeader({
  title,
  subtitle,
  onNavigate,
  titleId,
}: {
  title: string;
  subtitle: string;
  onNavigate: (path: string) => void;
  titleId?: string;
}) {
  const isDesktop = isTauriEnvironment();
  return (
    <div className="auth-card-header">
      <a
        href="/"
        className="auth-card-logo"
        onClick={(e) => {
          e.preventDefault();
          if (!isDesktop) onNavigate('/');
        }}
        aria-label="openqareer"
      >
        <BrandMark variant="lockup" size={32} />
      </a>
      <h1 id={titleId}>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}

/**
 * Typing a password you cannot read is how a typo becomes a locked account.
 * The control is a toggle rather than a mode switch, so a field never reveals
 * itself without being asked to.
 */
function PasswordRevealButton({
  controls,
  revealed,
  onToggle,
}: {
  controls: string;
  revealed: boolean;
  onToggle: () => void;
}) {
  const label = revealed ? 'Скрыть пароль' : 'Показать пароль';
  return (
    <button
      type="button"
      className="auth-reveal-button"
      onClick={onToggle}
      aria-pressed={revealed}
      aria-controls={controls}
      aria-label={label}
      title={label}
    >
      {revealed ? <EyeSlash size={18} /> : <Eye size={18} />}
    </button>
  );
}

export interface AuthInputFieldProps {
  id: string;
  name?: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  errorId?: string;
  /** A secondary control rendered beside the label, e.g. «Забыли пароль?». */
  action?: React.ReactNode;
}

export function AuthInputField({
  id,
  name,
  label,
  type = 'text',
  autoComplete,
  placeholder,
  value,
  onChange,
  disabled,
  required,
  error,
  errorId,
  action,
}: AuthInputFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="auth-field">
      <div className="auth-field-header">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <div className={isPassword ? 'auth-field-input has-reveal' : 'auth-field-input'}>
        <input
          id={id}
          name={name || id}
          type={isPassword && revealed ? 'text' : type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          aria-invalid={error && errorId ? true : undefined}
          aria-describedby={error && errorId ? errorId : undefined}
        />
        {isPassword ? (
          <PasswordRevealButton
            controls={id}
            revealed={revealed}
            onToggle={() => setRevealed((current) => !current)}
          />
        ) : null}
      </div>
      {error ? <p id={errorId} className="auth-field-error" role="alert">{error}</p> : null}
    </div>
  );
}

