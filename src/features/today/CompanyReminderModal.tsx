import React, { useRef, useState } from 'react';
import { Check, Copy, PaperPlaneTilt, X } from '@phosphor-icons/react';
import { useEscapeLayer } from '../shell/escapeLayers';
import { generateCompanyReminderDraft } from '../applications/companyReminderDraft';
import './companyReminderModal.css';

export interface CompanyReminderModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onMarkSent?: (applicationId: string) => Promise<void> | void;
  readonly applicationId: string;
  readonly company?: string | null;
  readonly positionTitle: string;
  readonly promisedDate?: string | null;
}

function useCompanyReminderModalState(props: CompanyReminderModalProps) {
  const { company, positionTitle, promisedDate, onMarkSent, applicationId, onClose } = props;
  const [draftText, setDraftText] = useState(() =>
    generateCompanyReminderDraft({
      company,
      positionTitle,
      promisedDate,
    }),
  );
  const [copied, setCopied] = useState(false);
  const [marking, setMarking] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draftText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleMarkSent = async () => {
    if (!onMarkSent) return;
    setMarking(true);
    try {
      await onMarkSent(applicationId);
      onClose();
    } finally {
      setMarking(false);
    }
  };

  return { draftText, setDraftText, copied, marking, handleCopy, handleMarkSent };
}

export function CompanyReminderModal(props: CompanyReminderModalProps) {
  const { isOpen, onClose, company, positionTitle } = props;
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(onClose, isOpen);

  const state = useCompanyReminderModalState(props);

  if (!isOpen) return null;

  return (
    <div
      className="career-reminder-modal-overlay"
      onMouseDown={(e) => {
        if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
      }}
      role="presentation"
    >
      <div
        className="career-reminder-modal-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-reminder-modal-title"
      >
        <ReminderHeader company={company} positionTitle={positionTitle} onClose={onClose} />
        <div className="career-reminder-modal-body">
          <ReminderNotice />
          <ReminderDraftField value={state.draftText} onChange={state.setDraftText} />
          <ReminderActions
            copied={state.copied}
            marking={state.marking}
            onCopy={state.handleCopy}
            onMarkSent={state.handleMarkSent}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}

function ReminderHeader({
  company,
  positionTitle,
  onClose,
}: {
  company?: string | null;
  positionTitle: string;
  onClose: () => void;
}) {
  return (
    <header className="career-reminder-modal-header">
      <div>
        <h2 id="company-reminder-modal-title" className="career-reminder-modal-title">
          Напоминание компании
        </h2>
        <p className="career-reminder-modal-subtitle">
          {positionTitle}{company ? ` · ${company}` : ''}
        </p>
      </div>
      <button
        type="button"
        className="career-btn-icon"
        onClick={onClose}
        aria-label="Закрыть"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>
  );
}

function ReminderNotice() {
  return (
    <div className="career-reminder-notice">
      <PaperPlaneTilt size={18} aria-hidden="true" />
      <span>
        OpenQareer не отправляет сообщения без вашего ведома. Скопируйте готовый черновик и отправьте работодателю в подходящий канал связи.
      </span>
    </div>
  );
}

function ReminderDraftField({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="career-reminder-field">
      <label htmlFor="company-reminder-textarea" className="career-reminder-label">
        Черновик сообщения
      </label>
      <textarea
        id="company-reminder-textarea"
        className="career-reminder-textarea"
        rows={7}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ReminderActions({
  copied,
  marking,
  onCopy,
  onMarkSent,
  onClose,
}: {
  copied: boolean;
  marking: boolean;
  onCopy: () => void;
  onMarkSent: () => void;
  onClose: () => void;
}) {
  return (
    <div className="career-reminder-modal-actions">
      <button
        type="button"
        className="career-btn career-btn-secondary"
        onClick={onClose}
      >
        Закрыть
      </button>
      <button
        type="button"
        className={`career-btn ${copied ? 'career-btn-secondary is-copied' : 'career-btn-secondary'}`}
        onClick={onCopy}
      >
        {copied ? (
          <>
            <Check size={16} aria-hidden="true" /> Скопировано
          </>
        ) : (
          <>
            <Copy size={16} aria-hidden="true" /> Скопировать черновик
          </>
        )}
      </button>
      <button
        type="button"
        className="career-btn career-btn-primary"
        onClick={onMarkSent}
        disabled={marking}
      >
        {marking ? 'Сохраняем…' : 'Отметить отправленным'}
      </button>
    </div>
  );
}
