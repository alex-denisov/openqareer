import { useId, useState } from 'react';
import { ArrowsClockwise, CheckCircle, LinkSimple } from '@phosphor-icons/react';
import { disconnectConnection, type CandidateConnection } from '../coach/coachApi';
import { ImportModalShell } from '../connections/ImportModalShell';
import { PLATFORM_LABELS } from '../connections/platformLabels';
import { importDateLabel } from './profileSourceLabels';

export interface ProfileSourceDialogProps {
  readonly platform: CandidateConnection['platform'];
  readonly connection?: CandidateConnection;
  readonly factCount?: number;
  /** N: facts of the import still in the profile (B541). */
  readonly keptFactCount?: number;
  readonly importedAt?: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** «Импортировать заново» и «Подключить» ведут в настоящий мастер подключения. */
  readonly onOpenConnections: () => void;
}

type Phase = 'idle' | 'confirm' | 'busy' | 'disconnected' | 'failed';

/** Макет 2 «Модальное окно: источник». */
export function ProfileSourceDialog(props: ProfileSourceDialogProps) {
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>('idle');
  const label = PLATFORM_LABELS[props.platform];
  const connected = props.connection?.status === 'connected' && phase !== 'disconnected';
  const disconnect = async () => {
    setPhase('busy');
    try {
      await disconnectConnection(props.platform);
      setPhase('disconnected');
    } catch {
      setPhase('failed');
    }
  };
  return (
    <ImportModalShell
      isOpen={props.isOpen}
      titleId={titleId}
      title={label}
      icon={<LinkSimple size={20} aria-hidden="true" />}
      onClose={props.onClose}
    >
      <div className="career-modal-body profile-source-dialog career-token-scope">
        <SourceStatus connection={props.connection} disconnected={phase === 'disconnected'} />
        <p>{importSummary(props.factCount, props.importedAt, props.keptFactCount)}</p>
        <PhaseNotice phase={phase} />
      </div>
      <div className="career-modal-footer career-token-scope">
        {connected ? (
          <DisconnectControl
            label={label}
            phase={phase}
            setPhase={setPhase}
            onConfirm={disconnect}
          />
        ) : null}
        <button type="button" className="career-quiet-button" onClick={props.onOpenConnections}>
          <ArrowsClockwise size={16} aria-hidden="true" />
          {connected || props.connection?.status === 'imported'
            ? 'Импортировать заново'
            : 'Подключить'}
        </button>
      </div>
    </ImportModalShell>
  );
}

function PhaseNotice({ phase }: { readonly phase: Phase }) {
  if (phase === 'disconnected')
    return <p role="status">Отключено. Импортированные факты остались в профиле.</p>;
  if (phase === 'failed')
    return <p role="alert">Не удалось отключить: сервер не ответил. Попробуйте ещё раз.</p>;
  return null;
}

function SourceStatus({
  connection,
  disconnected,
}: {
  readonly connection?: CandidateConnection;
  readonly disconnected: boolean;
}) {
  if (connection?.status === 'connected' && !disconnected) {
    const since = importDateLabel(connection.connectedAt);
    return (
      <p className="profile-source-dialog-status">
        <span className="career-profile-screen-tag is-verified">
          <CheckCircle size={14} aria-hidden="true" />
          Подключено
        </span>
        {since ? <span>с {since}</span> : null}
      </p>
    );
  }
  return (
    <p className="profile-source-dialog-status">
      <span className="career-profile-screen-tag">
        {connection?.status === 'imported' && !disconnected ? 'Импортировано' : 'Не подключено'}
      </span>
    </p>
  );
}

function DisconnectControl({
  label,
  phase,
  setPhase,
  onConfirm,
}: {
  readonly label: string;
  readonly phase: Phase;
  readonly setPhase: (phase: Phase) => void;
  readonly onConfirm: () => void;
}) {
  if (phase === 'confirm' || phase === 'busy') {
    return (
      <div
        className="profile-source-dialog-confirm"
        role="group"
        aria-label={`Отключить ${label}?`}
      >
        <span>Отключить {label}? Импортированные факты останутся.</span>
        <button
          type="button"
          className="career-danger-button"
          disabled={phase === 'busy'}
          onClick={onConfirm}
        >
          {phase === 'busy' ? 'Отключаем…' : 'Да, отключить'}
        </button>
        <button
          type="button"
          className="career-text-button"
          disabled={phase === 'busy'}
          onClick={() => setPhase('idle')}
        >
          Нет
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="career-danger-button" onClick={() => setPhase('confirm')}>
      Отключить
    </button>
  );
}

/** Макет 2: «Импортировано 9 из 9 …, 12.09» — the same N из M as the source chip (B541). */
export function importSummary(
  factCount?: number,
  importedAt?: string,
  keptFactCount?: number,
): string {
  if (factCount === undefined) return 'Импорта из этого источника ещё не было.';
  const date = importDateLabel(importedAt);
  const kept = keptFactCount ?? factCount;
  // «из N» takes the genitive: «из 1 факта», «из 4 фактов».
  const noun = factCount % 10 === 1 && factCount % 100 !== 11 ? 'факта' : 'фактов';
  return `Импортировано ${kept} из ${factCount} ${noun}${date ? `, ${date}` : ''}.`;
}
