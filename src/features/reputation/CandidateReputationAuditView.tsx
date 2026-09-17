import { useCallback, useEffect, useState } from 'react';
import {
  ArrowClockwise,
  CircleNotch,
  ShieldCheck,
  Warning,
  WarningOctagon,
  Info,
} from '@phosphor-icons/react';
import type {
  CandidateReputationAudit,
  ConsistencyDiscrepancy,
  ReputationOverallStatus,
  ReputationRiskItem,
} from '../../../shared/candidateReputation';
import {
  getLatestReputationAudit,
  startReputationAudit,
  type StartAuditOptions,
} from './candidateReputationApi';

export interface CandidateReputationAuditViewProps {
  readonly candidateId?: string;
  readonly initialAudit?: CandidateReputationAudit | null;
  readonly initialRunning?: boolean;
  readonly initialError?: string;
  readonly onAuditCompleted?: (audit: CandidateReputationAudit) => void;
}

function categoryTitle(category: ReputationRiskItem['category']): string {
  switch (category) {
    case 'toxic_workplace':
      return 'Токсичные высказывания о работодателе';
    case 'nda_leak':
      return 'Разглашение NDA / метрик';
    case 'compliance_conflict':
      return 'Комплаенс-конфликт';
    case 'polarizing_argument':
      return 'Поляризованный конфликтный контент';
  }
}

function statusBadgeProps(status: ReputationOverallStatus): {
  label: string;
  className: string;
  icon: typeof ShieldCheck;
} {
  switch (status) {
    case 'safe':
      return { label: 'Безопасно', className: 'is-safe', icon: ShieldCheck };
    case 'attention':
      return { label: 'Требует внимания', className: 'is-attention', icon: Warning };
    case 'critical_risk':
      return { label: 'Критический риск', className: 'is-critical', icon: WarningOctagon };
  }
}

function AuditScoreBanner({
  audit,
  running,
  onRecheck,
}: {
  audit: CandidateReputationAudit;
  running: boolean;
  onRecheck: () => void;
}) {
  const { label, className, icon: StatusIcon } = statusBadgeProps(audit.overallStatus);
  return (
    <div className={`career-reputation-score-banner ${className}`}>
      <div className="career-reputation-status-badge">
        <StatusIcon size={20} />
        <span className="career-reputation-status-text">{label}</span>
      </div>
      <div className="career-reputation-score-wrap">
        <span className="career-reputation-score-label">Оценка репутации:</span>
        <strong className="career-reputation-score-value">{audit.score} / 100</strong>
      </div>
      <button
        type="button"
        className="career-reputation-recheck-button"
        onClick={onRecheck}
        disabled={running}
      >
        <ArrowClockwise size={14} className={running ? 'spin' : ''} />
        <span>{running ? 'Анализ...' : 'Запустить повторный анализ'}</span>
      </button>
    </div>
  );
}

function DiscrepancyCard({ item }: { item: ConsistencyDiscrepancy }) {
  return (
    <li className={`career-reputation-item is-${item.severity}`}>
      <div className="career-reputation-item-header">
        <strong className="career-reputation-item-title">{item.field}</strong>
        <span className={`career-reputation-pill is-${item.severity}`}>
          {item.severity === 'critical' ? 'Критично' : 'Предупреждение'}
        </span>
      </div>
      <div className="career-reputation-discrepancy-grid">
        <div>
          <span className="career-reputation-sublabel">В резюме:</span>{' '}
          <code>{item.candidateValue}</code>
        </div>
        <div>
          <span className="career-reputation-sublabel">В {item.externalSource}:</span>{' '}
          <code>{item.externalValue}</code>
        </div>
      </div>
      <div className="career-reputation-remediation-box">
        <Info size={14} />
        <span>{item.suggestion}</span>
      </div>
    </li>
  );
}

function AuditDiscrepanciesBlock({ items }: { items: ConsistencyDiscrepancy[] }) {
  return (
    <section className="career-reputation-section" aria-labelledby="consistency-heading">
      <h3 id="consistency-heading">Согласованность истории (Cross-Source)</h3>
      {items.length === 0 ? (
        <div className="career-reputation-empty-box">
          <ShieldCheck size={18} />
          <span>Расхождений в датах и должностях между внешними профилями не обнаружено.</span>
        </div>
      ) : (
        <ul className="career-reputation-list">
          {items.map((item) => (
            <DiscrepancyCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RiskCard({ item }: { item: ReputationRiskItem }) {
  return (
    <li className={`career-reputation-item is-${item.severity}`}>
      <div className="career-reputation-item-header">
        <strong className="career-reputation-item-title">{categoryTitle(item.category)}</strong>
        <span className="career-reputation-platform-pill">{item.sourcePlatform}</span>
      </div>
      <blockquote className="career-reputation-excerpt">{item.excerpt}</blockquote>
      {item.sourceUrl ? (
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="career-reputation-source-link"
        >
          Ссылка на публикацию
        </a>
      ) : null}
      <div className="career-reputation-remediation-box is-risk">
        <Info size={14} />
        <span>{item.remediation}</span>
      </div>
    </li>
  );
}

function AuditRisksBlock({ items }: { items: ReputationRiskItem[] }) {
  return (
    <section className="career-reputation-section" aria-labelledby="risks-heading">
      <h3 id="risks-heading">Репутационные риски и публикации</h3>
      {items.length === 0 ? (
        <div className="career-reputation-empty-box">
          <ShieldCheck size={18} />
          <span>Потенциально компрометирующих публикаций и токсичных высказываний не обнаружено.</span>
        </div>
      ) : (
        <ul className="career-reputation-list">
          {items.map((item) => (
            <RiskCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditConsentDisclaimer() {
  return (
    <p className="career-reputation-disclaimer">
      Нажимая кнопку, вы инициируете аудит собственного открытого цифрового следа в
      соответствии с 152-ФЗ и GDPR. Поиск проводится исключительно по открытым публичным
      источникам. Ваши персональные данные не передаются третьим лицам.
    </p>
  );
}

function AuditUnstartedView({
  running,
  onStart,
}: {
  running: boolean;
  onStart: () => void;
}) {
  return (
    <div className="career-reputation-unstarted-card">
      <div className="career-reputation-unstarted-header">
        <ShieldCheck size={32} />
        <h3>Серверный аудит цифрового следа и репутации</h3>
      </div>
      <p className="career-reputation-unstarted-desc">
        Проверка согласованности карьерной истории по внешним публичным профилям (hh.ru,
        LinkedIn, Хабр Карьера, GitHub) и детекция репутационных рисков перед скринингом
        службы безопасности и нанимателей.
      </p>
      <button
        type="button"
        className="career-reputation-primary-button"
        onClick={onStart}
        disabled={running}
      >
        {running ? (
          <>
            <CircleNotch size={16} className="spin" />
            <span>Серверный анализ открытых источников...</span>
          </>
        ) : (
          'Запустить аудит цифрового следа и репутации'
        )}
      </button>
      <AuditConsentDisclaimer />
    </div>
  );
}

function AuditResultsView({
  audit,
  running,
  onRecheck,
}: {
  audit: CandidateReputationAudit;
  running: boolean;
  onRecheck: () => void;
}) {
  return (
    <div className="career-reputation-results">
      <AuditScoreBanner
        audit={audit}
        running={running}
        onRecheck={onRecheck}
      />
      <AuditDiscrepanciesBlock items={audit.consistencyDiscrepancies} />
      <AuditRisksBlock items={audit.reputationRisks} />
      <footer className="career-reputation-footer">
        <small>
          {audit.consentAction}. Аудит начат: {audit.startedAt}
          {audit.completedAt ? `, завершён: ${audit.completedAt}` : ''}
        </small>
      </footer>
    </div>
  );
}

function useCandidateReputationAudit(
  initialAudit: CandidateReputationAudit | null | undefined,
  initialRunning: boolean,
  initialError?: string,
  onAuditCompleted?: (audit: CandidateReputationAudit) => void,
) {
  const [audit, setAudit] = useState<CandidateReputationAudit | null>(initialAudit ?? null);
  const [running, setRunning] = useState(initialRunning);
  const [error, setError] = useState<string | undefined>(initialError);

  const loadAudit = useCallback(async () => {
    try {
      const data = await getLatestReputationAudit();
      if (data) setAudit(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить аудит');
    }
  }, []);

  useEffect(() => {
    if (initialAudit === undefined) {
      void loadAudit();
    }
  }, [initialAudit, loadAudit]);

  const handleStartAudit = useCallback(
    async (options?: StartAuditOptions) => {
      setRunning(true);
      setError(undefined);
      try {
        const result = await startReputationAudit(options);
        setAudit(result);
        onAuditCompleted?.(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка при проведении аудита');
      } finally {
        setRunning(false);
      }
    },
    [onAuditCompleted],
  );

  return { audit, running, error, handleStartAudit };
}

export function CandidateReputationAuditView({
  initialAudit = null,
  initialRunning = false,
  initialError,
  onAuditCompleted,
}: CandidateReputationAuditViewProps) {
  const { audit, running, error, handleStartAudit } = useCandidateReputationAudit(
    initialAudit,
    initialRunning,
    initialError,
    onAuditCompleted,
  );

  return (
    <div className="career-reputation-surface">
      <header className="career-reputation-header">
        <h2>Репутационный аудит и цифровой след</h2>
        <p className="career-reputation-intro">
          Объективная оценка профиля глазами службы безопасности и нанимателя.
        </p>
      </header>

      {error ? (
        <div className="career-reputation-error-alert" role="alert">
          <Warning size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {running && !audit ? (
        <div className="career-reputation-running-card">
          <CircleNotch size={24} className="spin" />
          <p>Серверный анализ открытых источников и сверка профилей...</p>
        </div>
      ) : null}

      {!audit && !running ? (
        <AuditUnstartedView
          running={running}
          onStart={() => void handleStartAudit()}
        />
      ) : null}

      {audit ? (
        <AuditResultsView
          audit={audit}
          running={running}
          onRecheck={() => void handleStartAudit()}
        />
      ) : null}
    </div>
  );
}

