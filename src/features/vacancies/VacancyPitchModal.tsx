import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  DownloadSimple,
  Envelope,
  FileText,
  LinkedinLogo,
  Users,
  X,
} from '@phosphor-icons/react';
import { requestVacancyPitch, type VacancyPitchResult } from './vacancyPitchApi';

export type PitchFormatTab = 'email' | 'linkedin' | 'ats';
export type PitchTone = 'executive' | 'confident' | 'technical';

export interface VacancyPitchModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly vacancy: {
    readonly id: string;
    readonly title: string;
    readonly company?: string;
    readonly location?: string;
    readonly isRemote?: boolean;
    readonly skills?: readonly string[];
    readonly descriptionSummary?: string;
  };
  readonly initialPitch?: VacancyPitchResult;
  readonly initialTab?: PitchFormatTab;
  readonly onOpenOutreach?: () => void;
  readonly onFetchPitch?: (
    vacancyId: string,
    tone: PitchTone,
  ) => Promise<VacancyPitchResult>;
}

const TONES: ReadonlyArray<{ id: PitchTone; label: string; desc: string }> = [
  { id: 'executive', label: 'Executive', desc: 'Фокус на бизнес-результатах и масштабе' },
  { id: 'confident', label: 'Confident', desc: 'Прямой отклик и готовность решать задачи' },
  { id: 'technical', label: 'Technical', desc: 'Глубина стека, архитектура и надежность' },
];

const FORMAT_TABS: ReadonlyArray<{
  id: PitchFormatTab;
  label: string;
  icon: typeof Envelope;
}> = [
  { id: 'email', label: 'Email-сопроводительное', icon: Envelope },
  { id: 'linkedin', label: 'LinkedIn Note', icon: LinkedinLogo },
  { id: 'ats', label: 'ATS Cover Letter', icon: FileText },
];

function pluralizeFacts(count: number): string {
  const tail = count % 10;
  const teen = count % 100;
  if (teen >= 11 && teen <= 14) return `${count} подтверждённых фактов`;
  if (tail === 1) return `${count} подтверждённый факт`;
  if (tail >= 2 && tail <= 4) return `${count} подтверждённых факта`;
  return `${count} подтверждённых фактов`;
}

function downloadTxtFile(filename: string, content: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function movePitchSelection<T extends string>(
  items: readonly { id: T }[],
  current: T,
  delta: number,
): T {
  const index = items.findIndex((item) => item.id === current);
  return items[(index + delta + items.length) % items.length]!.id;
}

function movePitchBoundary<T extends string>(
  items: readonly { id: T }[],
  boundary: 'first' | 'last',
): T {
  return boundary === 'first' ? items[0]!.id : items[items.length - 1]!.id;
}

function focusPitchSelection(event: React.KeyboardEvent<HTMLButtonElement>, id: string): void {
  const button = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
    `[data-pitch-value="${id}"]`,
  );
  button?.focus();
}

function PitchHeader({
  title,
  company,
  onClose,
}: {
  title: string;
  company?: string;
  onClose: () => void;
}) {
  return (
    <header className="career-pitch-header">
      <div className="career-pitch-title-block">
        <h2 id="career-pitch-title" className="career-pitch-title">
          Подготовка отклика: {title}
        </h2>
        {company ? <p className="career-pitch-subtitle">{company}</p> : null}
      </div>
      <button
        type="button"
        className="career-pitch-close-btn"
        onClick={onClose}
        aria-label="Закрыть модальное окно"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>
  );
}

// eslint-disable-next-line max-lines-per-function
function PitchControls({
  tone,
  tab,
  onToneChange,
  onTabChange,
}: {
  tone: PitchTone;
  tab: PitchFormatTab;
  onToneChange: (tone: PitchTone) => void;
  onTabChange: (tab: PitchFormatTab) => void;
}) {
  return (
    <section className="career-pitch-controls">
      <div className="career-pitch-tone-selector" role="radiogroup" aria-label="Тональность отклика">
        {TONES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            data-pitch-value={t.id}
            aria-checked={tone === t.id}
            className={`career-tab-btn ${tone === t.id ? 'is-active' : ''}`}
            onClick={() => onToneChange(t.id)}
            tabIndex={tone === t.id ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const next = movePitchBoundary(TONES, event.key === 'Home' ? 'first' : 'last');
                onToneChange(next);
                focusPitchSelection(event, next);
              } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                const next = movePitchSelection(TONES, tone, 1);
                onToneChange(next);
                focusPitchSelection(event, next);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                const next = movePitchSelection(TONES, tone, -1);
                onToneChange(next);
                focusPitchSelection(event, next);
              }
            }}
            title={t.desc}
          >
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="career-pitch-format-tabs" role="tablist" aria-label="Формат сопроводительных материалов">
        {FORMAT_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`career-pitch-tab-${t.id}`}
              data-pitch-value={t.id}
              aria-selected={tab === t.id}
              className={`career-tab-btn ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => onTabChange(t.id)}
              tabIndex={tab === t.id ? 0 : -1}
              aria-controls="career-pitch-panel"
              onKeyDown={(event) => {
                if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault();
                  const next = movePitchBoundary(FORMAT_TABS, event.key === 'Home' ? 'first' : 'last');
                  onTabChange(next);
                  focusPitchSelection(event, next);
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  const next = movePitchSelection(FORMAT_TABS, tab, 1);
                  onTabChange(next);
                  focusPitchSelection(event, next);
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const next = movePitchSelection(FORMAT_TABS, tab, -1);
                  onTabChange(next);
                  focusPitchSelection(event, next);
                }
              }}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PitchMetaBar({ evidenceCount }: { evidenceCount: number }) {
  return (
    <div className="career-pitch-meta-bar">
      <span className="career-pitch-evidence-tag">{pluralizeFacts(evidenceCount)}</span>
      <span className="career-pitch-safe-tag">
        Сформировано строго из подтверждённых данных профиля
      </span>
    </div>
  );
}

function EmailSubjectField({
  subject,
  copied,
  onCopy,
}: {
  subject: string;
  copied: boolean;
  onCopy: (text: string, key: string) => void;
}) {
  return (
    <div className="career-pitch-field-group">
      <label htmlFor="pitch-email-subject" className="career-pitch-field-label">
        Тема письма:
      </label>
      <div className="career-pitch-copyable-field">
        <input id="pitch-email-subject" type="text" readOnly value={subject} className="career-pitch-input" />
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          onClick={() => onCopy(subject, 'email-subject')}
          aria-label="Копировать тему письма"
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? 'Скопировано' : 'Тема'}</span>
        </button>
      </div>
    </div>
  );
}

function EmailPitchTab({
  emailPitch,
  copiedKey,
  onCopy,
}: {
  emailPitch: VacancyPitchResult['emailPitch'];
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const isCopied = copiedKey === 'email-full';
  return (
    <div className="career-pitch-content-tab">
      <EmailSubjectField
        subject={emailPitch.subject}
        copied={copiedKey === 'email-subject'}
        onCopy={onCopy}
      />
      <div className="career-pitch-field-group">
        <label htmlFor="pitch-email-body" className="career-pitch-field-label">
          Текст письма:
        </label>
        <textarea id="pitch-email-body" readOnly rows={10} value={emailPitch.body} className="career-pitch-textarea" />
      </div>
      <div className="career-pitch-actions">
        <button
          type="button"
          className="career-btn career-btn-primary"
          onClick={() => onCopy(`${emailPitch.subject}\n\n${emailPitch.body}`, 'email-full')}
        >
          {isCopied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          <span>{isCopied ? 'Скопировано в буфер' : 'Копировать письмо'}</span>
        </button>
      </div>
    </div>
  );
}

function LinkedInNoteActions({
  note,
  isCopied,
  onCopy,
  onOpenOutreach,
}: {
  readonly note: string;
  readonly isCopied: boolean;
  readonly onCopy: (text: string, key: string) => void;
  readonly onOpenOutreach?: () => void;
}) {
  return (
    <div className="career-pitch-actions">
      <button
        type="button"
        className="career-btn career-btn-primary"
        onClick={() => onCopy(note, 'linkedin')}
      >
        {isCopied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        <span>{isCopied ? 'Скопировано в буфер' : 'Копировать сообщение'}</span>
      </button>
      {onOpenOutreach ? (
        <button
          type="button"
          className="career-btn career-btn-secondary"
          onClick={onOpenOutreach}
          title="Открыть модуль нетворкинга и отправить запрос"
        >
          <Users size={16} aria-hidden="true" />
          <span>Открыть в нетворкинге</span>
        </button>
      ) : null}
    </div>
  );
}

function LinkedInNoteTab({
  note,
  copiedKey,
  onCopy,
  onOpenOutreach,
}: {
  note: string;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onOpenOutreach?: () => void;
}) {
  const isCopied = copiedKey === 'linkedin';
  return (
    <div className="career-pitch-content-tab">
      <div className="career-pitch-field-group">
        <div className="career-pitch-field-header">
          <label htmlFor="pitch-linkedin-text" className="career-pitch-field-label">
            Заметка к Connection Request:
          </label>
          <span className={`career-pitch-char-counter ${note.length > 300 ? 'is-overflow' : ''}`}>
            {note.length} / 300
          </span>
        </div>
        <textarea
          id="pitch-linkedin-text"
          readOnly
          rows={5}
          value={note}
          className="career-pitch-textarea"
        />
      </div>
      <LinkedInNoteActions
        note={note}
        isCopied={isCopied}
        onCopy={onCopy}
        onOpenOutreach={onOpenOutreach}
      />
    </div>
  );
}

function AtsCoverLetterTab({
  coverLetter,
  copiedKey,
  onCopy,
  onDownloadTxt,
}: {
  coverLetter: string;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onDownloadTxt: () => void;
}) {
  const isCopied = copiedKey === 'ats';
  return (
    <div className="career-pitch-content-tab">
      <div className="career-pitch-field-group">
        <label htmlFor="pitch-ats-text" className="career-pitch-field-label">
          Структурированное письмо для систем отклика (ATS):
        </label>
        <textarea
          id="pitch-ats-text"
          readOnly
          rows={12}
          value={coverLetter}
          className="career-pitch-textarea career-pitch-monospace"
        />
      </div>
      <div className="career-pitch-actions">
        <button type="button" className="career-btn career-btn-primary" onClick={() => onCopy(coverLetter, 'ats')}>
          {isCopied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          <span>{isCopied ? 'Скопировано в буфер' : 'Копировать текст'}</span>
        </button>
        <button type="button" className="career-btn career-btn-secondary" onClick={onDownloadTxt}>
          <DownloadSimple size={16} aria-hidden="true" />
          <span>Скачать .txt</span>
        </button>
      </div>
    </div>
  );
}

function executePitchFetch(
  vacancy: VacancyPitchModalProps['vacancy'],
  tone: PitchTone,
  onFetchPitch?: VacancyPitchModalProps['onFetchPitch'],
): Promise<VacancyPitchResult> {
  if (onFetchPitch) return onFetchPitch(vacancy.id, tone);
  return requestVacancyPitch(vacancy.id, {
    tone,
    vacancy: {
      title: vacancy.title,
      company: vacancy.company,
      description: vacancy.descriptionSummary,
      requiredSkills: vacancy.skills,
      location: vacancy.location,
      isRemote: vacancy.isRemote,
    },
  });
}

function usePitchFetcher(
  isOpen: boolean,
  vacancy: VacancyPitchModalProps['vacancy'],
  tone: PitchTone,
  initialPitch?: VacancyPitchResult,
  onFetchPitch?: VacancyPitchModalProps['onFetchPitch'],
) {
  const [pitch, setPitch] = useState<VacancyPitchResult | null>(initialPitch ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (initialPitch && tone === 'executive') {
      setPitch(initialPitch);
      return;
    }
    let isMounted = true;
    setLoading(true);
    setError(null);
    executePitchFetch(vacancy, tone, onFetchPitch)
      .then((data) => {
        if (isMounted) {
          setPitch(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Ошибка генерации материалов.');
          setLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [isOpen, vacancy, tone, initialPitch, onFetchPitch]);

  return { pitch, loading, error };
}

function useModalAccessibility(
  isOpen: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the modal container on mount
    containerRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]),'
            + ' [contenteditable="true"]',
        ) ?? [],
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus?.();
    };
  }, [isOpen, onClose, containerRef]);
}


interface PitchMainViewProps {
  readonly loading: boolean;
  readonly error: string | null;
  readonly pitch: VacancyPitchResult | null;
  readonly tab: PitchFormatTab;
  readonly copiedKey: string | null;
  readonly onCopy: (text: string, key: string) => void;
  readonly onDownloadTxt: () => void;
  readonly onOpenOutreach?: () => void;
}

function PitchMainView(props: PitchMainViewProps) {
  const { loading, error, pitch, tab, copiedKey, onCopy, onDownloadTxt, onOpenOutreach } = props;
  if (loading) {
    return (
      <div className="career-pitch-loading" aria-busy="true">
        <p>Синтезируем точечные материалы под требования вакансии...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="career-pitch-error" role="alert">
        <p>{error}</p>
      </div>
    );
  }
  if (!pitch) return null;
  if (tab === 'email') {
    return <EmailPitchTab emailPitch={pitch.emailPitch} copiedKey={copiedKey} onCopy={onCopy} />;
  }
  if (tab === 'linkedin') {
    return (
      <LinkedInNoteTab
        note={pitch.linkedInNote}
        copiedKey={copiedKey}
        onCopy={onCopy}
        onOpenOutreach={onOpenOutreach}
      />
    );
  }
  return (
    <AtsCoverLetterTab
      coverLetter={pitch.atsCoverLetter}
      copiedKey={copiedKey}
      onCopy={onCopy}
      onDownloadTxt={onDownloadTxt}
    />
  );
}

function usePitchModalActions(pitch: VacancyPitchResult | null, vacancyTitle: string) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (text: string, key: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const handleDownloadTxt = () => {
    if (!pitch) return;
    const safeTitle = vacancyTitle.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/gu, '_');
    downloadTxtFile(`Cover_Letter_${safeTitle}.txt`, pitch.atsCoverLetter);
  };

  return { copiedKey, handleCopy, handleDownloadTxt };
}

function usePitchModalController(
  props: VacancyPitchModalProps,
  cardRef: React.RefObject<HTMLDivElement | null>,
) {
  const { isOpen, onClose, vacancy, initialPitch, initialTab = 'email', onFetchPitch } = props;
  const [tab, setTab] = useState<PitchFormatTab>(initialTab);
  const [tone, setTone] = useState<PitchTone>('executive');
  const { pitch, loading, error } = usePitchFetcher(isOpen, vacancy, tone, initialPitch, onFetchPitch);
  const { copiedKey, handleCopy, handleDownloadTxt } = usePitchModalActions(pitch, vacancy.title);

  useModalAccessibility(isOpen, onClose, cardRef);

  return {
    tab,
    setTab,
    tone,
    setTone,
    pitch,
    loading,
    error,
    copiedKey,
    handleCopy,
    handleDownloadTxt,
  };
}

export function VacancyPitchModal(props: VacancyPitchModalProps) {
  const { isOpen, onClose, vacancy, onOpenOutreach } = props;
  const cardRef = useRef<HTMLDivElement>(null);
  const c = usePitchModalController(props, cardRef);

  if (!isOpen) return null;

  return (
    <div
      className="career-pitch-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (!cardRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        className="career-pitch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="career-pitch-title"
        tabIndex={-1}
        ref={cardRef}
      >
        <PitchHeader title={vacancy.title} company={vacancy.company} onClose={onClose} />
        <PitchControls tone={c.tone} tab={c.tab} onToneChange={c.setTone} onTabChange={c.setTab} />
        {c.pitch ? <PitchMetaBar evidenceCount={c.pitch.usedEvidenceIds.length} /> : null}
        <main
          id="career-pitch-panel"
          className="career-pitch-body"
          role="tabpanel"
          aria-labelledby={`career-pitch-tab-${c.tab}`}
          tabIndex={0}
        >
          <PitchMainView
            loading={c.loading}
            error={c.error}
            pitch={c.pitch}
            tab={c.tab}
            copiedKey={c.copiedKey}
            onCopy={c.handleCopy}
            onDownloadTxt={c.handleDownloadTxt}
            onOpenOutreach={onOpenOutreach}
          />
        </main>
      </div>
    </div>
  );
}
