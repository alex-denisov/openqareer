import { useState, useMemo } from 'react';
import { Check, Copy, Clock, ArrowSquareOut } from '@phosphor-icons/react';
import type { VacancyApplication } from '../../../shared/vacancyApplication';
import {
  findPendingFollowUps,
  type PendingFollowUp,
} from './followUpTracker';

export interface FollowUpActionCardProps {
  readonly applications?: readonly VacancyApplication[];
  readonly pendingFollowUps?: readonly PendingFollowUp[];
  readonly onOpenVacancy?: (clusterId: string) => void;
  readonly className?: string;
}

export function FollowUpActionCard({
  applications,
  pendingFollowUps: providedPending,
  onOpenVacancy,
  className = '',
}: FollowUpActionCardProps) {
  const pending = useMemo(() => {
    if (providedPending) return providedPending;
    if (applications) return findPendingFollowUps(applications);
    return [];
  }, [providedPending, applications]);

  if (pending.length === 0) {
    return null;
  }

  return (
    <div className={`career-followup-container ${className}`.trim()}>
      {pending.map((item) => (
        <FollowUpSingleCard
          key={item.application.clusterId}
          item={item}
          onOpenVacancy={onOpenVacancy}
        />
      ))}
    </div>
  );
}

function FollowUpSingleCard({
  item,
  onOpenVacancy,
}: {
  readonly item: PendingFollowUp;
  readonly onOpenVacancy?: (clusterId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const company = item.application.vacancy.company || 'компании';
  const headline = `Пора напомнить о себе в ${company} — ${item.daysSinceApplied}-й день без ответа`;

  const handleCopy = async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(item.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <section className="career-followup-card" aria-labelledby={`followup-title-${item.application.clusterId}`}>
      <FollowUpHeader item={item} headline={headline} />
      <div className="career-followup-body">
        <p className="career-followup-message-preview">{item.message}</p>
      </div>
      <FollowUpFooter
        item={item}
        copied={copied}
        onCopy={handleCopy}
        onOpenVacancy={onOpenVacancy}
      />
    </section>
  );
}

function FollowUpHeader({
  item,
  headline,
}: {
  readonly item: PendingFollowUp;
  readonly headline: string;
}) {
  const stageLabel = item.stage === 'day_8' ? 'Финальное касание' : 'Первое касание';
  const stageClass = item.stage === 'day_8' ? 'is-warning' : 'is-accent';

  return (
    <header className="career-followup-header">
      <div className="career-followup-meta">
        <span className="career-followup-kicker">
          <Clock size={14} aria-hidden="true" />
          <span>Напоминание о повторном касании</span>
        </span>
        <span className={`career-followup-badge ${stageClass}`}>{stageLabel}</span>
      </div>
      <h3 id={`followup-title-${item.application.clusterId}`} className="career-followup-headline">
        {headline}
      </h3>
      <p className="career-followup-vacancy">
        Вакансия: <strong>{item.application.vacancy.title}</strong>
      </p>
    </header>
  );
}

function FollowUpFooter({
  item,
  copied,
  onCopy,
  onOpenVacancy,
}: {
  readonly item: PendingFollowUp;
  readonly copied: boolean;
  readonly onCopy: () => void;
  readonly onOpenVacancy?: (clusterId: string) => void;
}) {
  return (
    <footer className="career-followup-actions">
      <button
        type="button"
        className={`career-followup-copy-btn ${copied ? 'is-success' : ''}`}
        onClick={onCopy}
        aria-label="Скопировать сообщение повторного касания"
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        <span>{copied ? 'Скопировано' : 'Скопировать сообщение'}</span>
      </button>

      {item.application.vacancy.url ? (
        <a
          href={item.application.vacancy.url}
          target="_blank"
          rel="noreferrer"
          className="career-followup-link"
        >
          <span>К вакансии</span>
          <ArrowSquareOut size={14} aria-hidden="true" />
        </a>
      ) : onOpenVacancy ? (
        <button
          type="button"
          className="career-followup-link"
          onClick={() => onOpenVacancy(item.application.clusterId)}
        >
          <span>К вакансии</span>
          <ArrowSquareOut size={14} aria-hidden="true" />
        </button>
      ) : null}
    </footer>
  );
}
