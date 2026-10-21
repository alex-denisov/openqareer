import { WarningCircle } from '@phosphor-icons/react';

export function RelocationScreenState({
  busy,
  message,
  onRetry,
}: {
  readonly busy?: boolean;
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  const Tag = busy ? 'div' : 'section';
  return (
    <Tag className="career-relocation-state" aria-busy={busy} role={busy ? 'status' : 'alert'}>
      <p>
        {busy ? null : <WarningCircle aria-hidden="true" size={18} />}
        {message}
      </p>
      {onRetry ? (
        <button className="career-btn career-btn-secondary" type="button" onClick={onRetry}>
          Повторить загрузку
        </button>
      ) : null}
    </Tag>
  );
}
