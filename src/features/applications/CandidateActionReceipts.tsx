import { CheckCircle, Hourglass, WarningCircle, XCircle } from '@phosphor-icons/react';
import type { ApplicationView, CandidateActionReceiptView } from './applicationsApi';
import { actionFailureLabel, actionStatusLabel } from './candidateActionModel';

const STATUS_TONE = {
  pending: 'is-muted',
  delivered: 'is-good',
  attempted: 'is-warn',
  failed: 'is-danger',
} as const;

const STATUS_ICON = {
  pending: Hourglass,
  delivered: CheckCircle,
  attempted: WarningCircle,
  failed: XCircle,
} as const;

function platformLabel(platform: CandidateActionReceiptView['platform']): string {
  return platform === 'hh' ? 'hh.ru' : 'LinkedIn';
}

function companyLabel(
  receipt: CandidateActionReceiptView,
  applications: ReadonlyMap<string, ApplicationView>,
): string {
  if (receipt.actionKind === 'hh_resume_boost') return 'Поднятие резюме';
  const vacancy = receipt.applicationId
    ? applications.get(receipt.applicationId)?.vacancy
    : undefined;
  if (vacancy?.companyHidden) return 'Компания скрыта';
  return vacancy?.company || 'Компания не указана';
}

function formatExecuted(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(',', '');
}

export function ReceiptStatus({
  status,
}: {
  readonly status: CandidateActionReceiptView['status'];
}) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`career-pill ${STATUS_TONE[status]}`}>
      <Icon aria-hidden="true" />
      {actionStatusLabel(status)}
    </span>
  );
}

export function ReceiptTable({
  receipts,
  applications,
  caption,
}: {
  readonly receipts: readonly CandidateActionReceiptView[];
  readonly applications: ReadonlyMap<string, ApplicationView>;
  readonly caption: string;
}) {
  return (
    <div className="career-candidate-actions__table-wrap">
      <table className="career-candidate-actions__table is-plain" aria-label={caption}>
        <thead>
          <tr>
            <th scope="col">Когда</th>
            <th scope="col">Компания</th>
            <th scope="col">Канал</th>
            <th scope="col">Результат</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((receipt) => (
            <tr key={receipt.id}>
              <td className="career-candidate-actions__num">
                {formatExecuted(receipt.executedAt)}
              </td>
              <th scope="row">
                <strong>{companyLabel(receipt, applications)}</strong>
              </th>
              <td>{platformLabel(receipt.platform)}</td>
              <td>
                <ReceiptStatus status={receipt.status} />
                {receipt.failureCode ? (
                  <span className="career-candidate-actions__reason">
                    {actionFailureLabel(receipt.failureCode)}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
