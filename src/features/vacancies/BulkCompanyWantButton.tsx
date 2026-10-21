import { useState } from 'react';
import { Target } from '@phosphor-icons/react';
import { addSelectionCompaniesToWant, type BulkCompanyWantResult } from './candidateCompaniesApi';

export interface BulkCompanyWantButtonProps {
  /** Компаний в текущей подборке; без числа кнопка не показывает счёт и не активна. */
  readonly count?: number;
  readonly className: string;
  readonly onDone?: (result: BulkCompanyWantResult) => void;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly result: BulkCompanyWantResult }
  | { readonly kind: 'error'; readonly message: string };

export function bulkWantResultLabel(result: BulkCompanyWantResult): string {
  const already = result.alreadyWanted > 0 ? `, ${result.alreadyWanted} уже в «Хочу»` : '';
  return `Добавлено ${result.added}${already}.`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error && reason.message
    ? reason.message
    : 'Не удалось добавить компании в «Хочу».';
}

/** B422: «Все компании подборки в «Хочу»» — подтверждение, одна операция, итог. */
export function BulkCompanyWantButton({ count, className, onDone }: BulkCompanyWantButtonProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const run = async () => {
    setPhase({ kind: 'busy' });
    try {
      const result = await addSelectionCompaniesToWant();
      setPhase({ kind: 'done', result });
      onDone?.(result);
    } catch (reason) {
      setPhase({ kind: 'error', message: errorMessage(reason) });
    }
  };
  if (phase.kind === 'confirm' && count !== undefined) {
    return (
      <div className="bulk-company-want-confirm" role="group" aria-label="Подтверждение">
        <span>Добавить {count} компаний в «Хочу»?</span>
        <button type="button" className={className} onClick={() => void run()}>
          Добавить
        </button>
        <button type="button" className={className} onClick={() => setPhase({ kind: 'idle' })}>
          Отмена
        </button>
      </div>
    );
  }
  return (
    <span className="bulk-company-want">
      <button
        type="button"
        className={className}
        disabled={count === undefined || count === 0 || phase.kind === 'busy'}
        onClick={() => setPhase({ kind: 'confirm' })}
      >
        <Target size={15} aria-hidden="true" />
        Все компании подборки в «Хочу»{count !== undefined ? ` (${count})` : ''}
      </button>
      {phase.kind === 'done' ? (
        <span role="status">{bulkWantResultLabel(phase.result)}</span>
      ) : null}
      {phase.kind === 'error' ? <span role="alert">{phase.message}</span> : null}
    </span>
  );
}
