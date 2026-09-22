import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowSquareOut,
  Check,
  CircleNotch,
  Copy,
  PaperPlaneTilt,
  ShieldCheck,
  User,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import {
  canSendInvite,
  getOutreachQuota,
  searchDecisionMakers,
  sendDesktopConnectionRequest,
  type DecisionMakerProfile,
  type DecisionMakerRoleCategory,
  type OutreachDailyQuota,
} from '../../services/desktop/desktopOutreachService';
import {
  getOutreachRecords,
  recordOutreachInvite,
  type OutreachRecord,
} from './outreachTrackingStore';

export interface DesktopOutreachModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly vacancy: {
    readonly id: string;
    readonly title: string;
    readonly company?: string;
    readonly location?: string;
    readonly isRemote?: boolean;
    readonly skills?: readonly string[];
  };
  readonly candidateId?: string;
  readonly initialNote?: string;
  readonly initialProfiles?: readonly DecisionMakerProfile[];
  readonly onSent?: (record: OutreachRecord) => void;
}

type RoleFilter = 'all' | DecisionMakerRoleCategory;

function pluralizeMutual(count: number): string {
  const tail = count % 10;
  const teen = count % 100;
  if (teen >= 11 && teen <= 14) return `${count} общих контактов`;
  if (tail === 1) return `${count} общий контакт`;
  if (tail >= 2 && tail <= 4) return `${count} общих контакта`;
  return `${count} общих контактов`;
}

function OutreachHeader({
  company,
  vacancyTitle,
  isDesktop,
  onClose,
}: {
  readonly company?: string;
  readonly vacancyTitle: string;
  readonly isDesktop: boolean;
  readonly onClose: () => void;
}) {
  return (
    <header className="career-outreach-header">
      <div className="career-outreach-title-block">
        <div className="career-outreach-title-row">
          <h2 id="career-outreach-modal-title" className="career-outreach-title">
            Нетворкинг{company ? `: ${company}` : ''}
          </h2>
          <span
            className={`career-outreach-session-badge ${isDesktop ? 'is-desktop' : 'is-web'}`}
            data-session={isDesktop ? 'desktop' : 'web'}
          >
            <ShieldCheck size={14} aria-hidden="true" />
            <span>{isDesktop ? 'Отправка из приложения' : 'Только копирование (веб)'}</span>
          </span>
        </div>
        <p className="career-outreach-subtitle">
          {vacancyTitle}. Ваши контакты на площадках, кто работает здесь или знает нанимающего.
          Отправляете вы — из своей сессии в приложении или вручную.
        </p>
      </div>
      <button
        type="button"
        className="career-outreach-close-btn"
        onClick={onClose}
        aria-label="Закрыть модальное окно"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>
  );
}

function OutreachQuotaBanner({ quota }: { readonly quota: OutreachDailyQuota }) {
  const rawShare = quota.dailyLimit > 0
    ? Math.min(100, Math.round((quota.usedToday / quota.dailyLimit) * 100))
    : 0;
  const stepShare = String(Math.round(rawShare / 10) * 10);

  return (
    <div className={`career-outreach-quota-banner ${!quota.allowed ? 'is-exhausted' : ''}`}>
      <div className="career-outreach-quota-head">
        <span className="career-outreach-quota-label">
          Сегодня <strong>{quota.usedToday}</strong> из <strong>{quota.dailyLimit}</strong> инвайтов.
          {' '}
          {quota.allowed ? (
            <span>Осталось {quota.remaining}</span>
          ) : (
            <span className="career-outreach-quota-warning">Лимит на сегодня</span>
          )}
        </span>
        {/* Иначе лимит выглядит как ограничение тарифа (B236 §5.4). */}
        <span className="career-outreach-quota-safe-tag">Защита от блокировки площадкой</span>
      </div>
      <div
        className="career-outreach-progress-track"
        role="progressbar"
        aria-valuenow={quota.usedToday}
        aria-valuemin={0}
        aria-valuemax={quota.dailyLimit}
      >
        <div className="career-outreach-progress-fill" data-share={stepShare} />
      </div>
      {!quota.allowed && (
        <p className="career-outreach-quota-alert" role="alert">
          {quota.dailyLimit} из {quota.dailyLimit} на сегодня. Больше опасно: площадка может заблокировать аккаунт. Продолжить можно завтра.
        </p>
      )}
    </div>
  );
}

const ROLE_TABS: ReadonlyArray<{ id: RoleFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'recruiter', label: 'Рекрутеры' },
  { id: 'engineering_lead', label: 'Hiring managers' },
  { id: 'executive', label: 'C-Level' },
  { id: 'peer', label: 'Коллеги' },
];

function OutreachFilterTabs({
  activeFilter,
  counts,
  onSelect,
}: {
  readonly activeFilter: RoleFilter;
  readonly counts: Record<RoleFilter, number>;
  readonly onSelect: (filter: RoleFilter) => void;
}) {
  return (
    <div className="career-outreach-tabs" role="tablist" aria-label="Категории контактов">
      {ROLE_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeFilter === tab.id}
          className={`career-tab-btn ${activeFilter === tab.id ? 'is-active' : ''}`}
          onClick={() => onSelect(tab.id)}
        >
          <span>{tab.label} ({counts[tab.id] ?? 0})</span>
        </button>
      ))}
    </div>
  );
}

function DecisionMakerInfo({ profile }: { readonly profile: DecisionMakerProfile }) {
  const degreeClass = profile.connectionDegree === '1st' ? 'is-1st' : 'is-2nd';

  return (
    <div className="career-outreach-person-info">
      <div className="career-outreach-name-row">
        <strong>{profile.fullName}</strong>
        <span className={`career-outreach-degree-badge ${degreeClass}`}>
          {profile.connectionDegree === '1st'
            ? '1-й круг'
            : profile.connectionDegree === '2nd'
              ? '2-й круг'
              : '3-й круг'}
        </span>
      </div>
      <p className="career-outreach-headline">{profile.headline}</p>
      <div className="career-outreach-meta-row">
        <span className="career-outreach-mutual-count">
          {profile.mutualConnectionsCount > 0
            ? pluralizeMutual(profile.mutualConnectionsCount)
            : 'Ваш контакт'}
        </span>
        <a
          href={profile.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="career-outreach-link"
          onClick={(e) => e.stopPropagation()}
        >
          <span>Профиль</span>
          <ArrowSquareOut size={13} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

function DecisionMakerCard({
  profile,
  isSelected,
  onSelect,
}: {
  readonly profile: DecisionMakerProfile;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <div
      className={`career-outreach-card ${isSelected ? 'is-selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-pressed={isSelected}
    >
      <div className="career-outreach-card-left">
        <div className="career-outreach-avatar" aria-hidden="true">
          <User size={20} />
        </div>
        <DecisionMakerInfo profile={profile} />
      </div>
      <div className="career-outreach-card-action">
        <span className={`career-outreach-select-pill ${isSelected ? 'is-active' : ''}`}>
          {isSelected ? 'Выбран' : 'Выбрать'}
        </span>
      </div>
    </div>
  );
}

function WebModeNotice({
  note,
  onCopy,
  copied,
}: {
  readonly note: string;
  readonly onCopy: (text: string) => void;
  readonly copied: boolean;
}) {
  return (
    <div className="career-outreach-web-notice">
      <div className="career-outreach-web-notice-head">
        <WarningCircle size={18} aria-hidden="true" />
        <p>
          В веб-версии отправить нельзя. Скопируйте текст и вставьте его на площадке. В приложении
          отправка идёт из вашей сессии; пароль и сессия к нам не попадают.
        </p>
      </div>
      <button
        type="button"
        className="career-btn career-btn-primary"
        onClick={() => onCopy(note)}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        <span>{copied ? 'Скопировано в буфер' : 'Скопировать текст'}</span>
      </button>
    </div>
  );
}

function DesktopSendAction({
  onSend,
  sending,
  disabled,
  confirmed,
  onToggleConfirm,
}: {
  readonly onSend: () => void;
  readonly sending: boolean;
  readonly disabled: boolean;
  readonly confirmed: boolean;
  readonly onToggleConfirm: () => void;
}) {
  return (
    <div className="career-outreach-desktop-actions">
      <label className="career-outreach-confirm-label">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={onToggleConfirm}
          disabled={disabled || sending}
        />
        <span>Отправить от моего имени из моего аккаунта на площадке</span>
      </label>
      <button
        type="button"
        className="career-btn career-btn-primary"
        onClick={onSend}
        disabled={disabled || sending || !confirmed}
      >
        {sending ? (
          <>
            <CircleNotch size={16} className="career-spin" aria-hidden="true" />
            <span>Отправляем из приложения…</span>
          </>
        ) : (
          <>
            <PaperPlaneTilt size={16} aria-hidden="true" />
            <span>Отправить с площадки</span>
          </>
        )}
      </button>
    </div>
  );
}

function OutreachNoteInputs({
  note,
  onNoteChange,
  isOverflow,
  selectedProfile,
  sendError,
}: {
  readonly note: string;
  readonly onNoteChange: (val: string) => void;
  readonly isOverflow: boolean;
  readonly selectedProfile?: DecisionMakerProfile;
  readonly sendError: string | null;
}) {
  return (
    <>
      <div className="career-outreach-form-header">
        <label htmlFor="outreach-note-textarea" className="career-outreach-field-label">
          Заметка к запросу в контакты
        </label>
        <span className={`career-outreach-char-count ${isOverflow ? 'is-overflow' : ''}`}>
            {note.length} из 300
        </span>
      </div>
      {selectedProfile ? (
        <p className="career-outreach-recipient-badge">
          Кому: <strong>{selectedProfile.fullName}</strong> ({selectedProfile.headline})
        </p>
      ) : null}
      <textarea
        id="outreach-note-textarea"
        rows={4}
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        className="career-pitch-textarea"
        placeholder="Кто вы, почему пишете и что хотите узнать. 2-3 предложения"
      />
      {sendError ? (
        <p className="career-outreach-error-banner" role="alert">
          {sendError}
        </p>
      ) : null}
    </>
  );
}

function OutreachNoteForm({
  isDesktop,
  selectedProfile,
  note,
  onNoteChange,
  onCopy,
  copied,
  onSend,
  sending,
  sendError,
  quotaAllowed,
}: {
  readonly isDesktop: boolean;
  readonly selectedProfile?: DecisionMakerProfile;
  readonly note: string;
  readonly onNoteChange: (val: string) => void;
  readonly onCopy: (text: string) => void;
  readonly copied: boolean;
  readonly onSend: () => void;
  readonly sending: boolean;
  readonly sendError: string | null;
  readonly quotaAllowed: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const isOverflow = note.length > 300;
  const canSubmit = quotaAllowed && !isOverflow && Boolean(selectedProfile) && note.trim().length > 0;

  return (
    <section className="career-outreach-form-section">
      <OutreachNoteInputs
        note={note}
        onNoteChange={onNoteChange}
        isOverflow={isOverflow}
        selectedProfile={selectedProfile}
        sendError={sendError}
      />
      {isDesktop ? (
        <DesktopSendAction
          onSend={onSend}
          sending={sending}
          disabled={!canSubmit}
          confirmed={confirmed}
          onToggleConfirm={() => setConfirmed(!confirmed)}
        />
      ) : (
        <WebModeNotice note={note} onCopy={onCopy} copied={copied} />
      )}
    </section>
  );
}

function OutreachRecordsHistory({ records }: { readonly records: readonly OutreachRecord[] }) {
  if (records.length === 0) return null;

  return (
    <div className="career-outreach-history">
      <h3 className="career-outreach-history-title">
        Кому писали ({records.length})
      </h3>
      <div className="career-outreach-history-list">
        {records.map((r) => (
          <div key={r.id} className="career-outreach-history-item">
            <span className="career-outreach-history-name">{r.contactName}</span>
            <span className={`career-outreach-status-pill is-${r.status}`}>
              {r.status === 'invite_sent'
                ? 'Отправлено'
                : r.status === 'connected'
                  ? 'Принял'
                  : r.status === 'dialogue_started'
                    ? 'Ответил'
                    : r.status}
            </span>
            <small className="career-outreach-history-date">
              {r.sentAt ? new Date(r.sentAt).toLocaleDateString('ru-RU') : ''}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

function useOutreachModalState(
  isOpen: boolean,
  vacancy: DesktopOutreachModalProps['vacancy'],
  initialNote?: string,
  initialProfiles?: readonly DecisionMakerProfile[],
  candidateId?: string,
) {
  const [filter, setFilter] = useState<RoleFilter>('all');
  const defaultList = useMemo(
    () => (initialProfiles ? [...initialProfiles] : []),
    [initialProfiles],
  );
  const [profiles, setProfiles] = useState<DecisionMakerProfile[]>(defaultList);
  const [selectedId, setSelectedId] = useState<string>(defaultList[0]?.id ?? '');
  const [note, setNote] = useState<string>(
      initialNote ||
      `Здравствуйте! Вижу, вы работаете в ${vacancy.company ?? 'компании'}. Пишу по роли ${vacancy.title}; буду рад(а) задать пару вопросов о команде.`,
  );
  const [quota, setQuota] = useState<OutreachDailyQuota>(getOutreachQuota(undefined, candidateId));
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setQuota(getOutreachQuota(undefined, candidateId));
    void searchDecisionMakers({ company: vacancy.company ?? '' }).then((res) => {
      setProfiles(res);
      if (res.length > 0 && !selectedId) {
        setSelectedId(res[0].id);
      }
    });
  }, [candidateId, isOpen, vacancy.company, selectedId]);

  return {
    filter,
    setFilter,
    profiles,
    selectedId,
    setSelectedId,
    note,
    setNote,
    quota,
    setQuota,
    sending,
    setSending,
    sendError,
    setSendError,
    copied,
    setCopied,
  };
}

// eslint-disable-next-line max-lines-per-function
function useOutreachSendHandler({
  selectedProfile,
  note,
  vacancy,
  candidateId,
  setSending,
  setSendError,
  setQuota,
  onSent,
}: {
  readonly selectedProfile?: DecisionMakerProfile;
  readonly note: string;
  readonly vacancy: DesktopOutreachModalProps['vacancy'];
  readonly candidateId?: string;
  readonly setSending: (val: boolean) => void;
  readonly setSendError: (val: string | null) => void;
  readonly setQuota: (quota: OutreachDailyQuota) => void;
  readonly onSent?: (record: OutreachRecord) => void;
}) {
  return async () => {
    if (!selectedProfile) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await sendDesktopConnectionRequest({
        profile: selectedProfile,
        note,
        candidateId,
      });
      if (!result.success) {
        setSendError(result.errorReason || 'Не удалось отправить. Скопируйте и отправьте вручную.');
        setSending(false);
        return;
      }
      const record = recordOutreachInvite({
        candidateId,
        vacancyId: vacancy.id,
        company: vacancy.company ?? selectedProfile.company,
        contactName: selectedProfile.fullName,
        contactProfileUrl: selectedProfile.profileUrl,
        connectionNote: note,
      });
      setQuota(getOutreachQuota(undefined, candidateId));
      onSent?.(record);
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : 'Не удалось отправить. Скопируйте и отправьте вручную.',
      );
    } finally {
      setSending(false);
    }
  };
}

function useModalA11y(
  isOpen: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const prevActive = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
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
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
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
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      prevActive?.focus?.();
    };
  }, [isOpen, onClose, containerRef]);
}

function calculateCategoryCounts(profiles: readonly DecisionMakerProfile[]): Record<RoleFilter, number> {
  return {
    all: profiles.length,
    recruiter: profiles.filter((p) => p.roleCategory === 'recruiter').length,
    engineering_lead: profiles.filter((p) => p.roleCategory === 'engineering_lead').length,
    executive: profiles.filter((p) => p.roleCategory === 'executive').length,
    peer: profiles.filter((p) => p.roleCategory === 'peer').length,
  };
}

function useCopyAction(setCopied: (val: boolean) => void) {
  return async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
}

function useDesktopOutreachController(
  props: DesktopOutreachModalProps,
  cardRef: React.RefObject<HTMLDivElement | null>,
) {
  const { isOpen, onClose, vacancy, initialNote, initialProfiles, onSent } = props;
  const candidateId = props.candidateId;
  const isDesktop = useMemo(() => isTauriEnvironment(), []);
  const state = useOutreachModalState(isOpen, vacancy, initialNote, initialProfiles, candidateId);
  useModalA11y(isOpen, onClose, cardRef);

  const counts = useMemo(() => calculateCategoryCounts(state.profiles), [state.profiles]);
  const shownProfiles = useMemo(
    () =>
      state.filter === 'all'
        ? state.profiles
        : state.profiles.filter((p) => p.roleCategory === state.filter),
    [state.profiles, state.filter],
  );
  const selectedProfile = useMemo(
    () => state.profiles.find((p) => p.id === state.selectedId),
    [state.profiles, state.selectedId],
  );
  const historyRecords = useMemo(
    () => (isOpen ? getOutreachRecords(candidateId, vacancy.id) : []),
    [candidateId, isOpen, vacancy.id],
  );

  const handleCopy = useCopyAction(state.setCopied);

  const handleSend = useOutreachSendHandler({
    selectedProfile,
    note: state.note,
    vacancy,
    candidateId,
    setSending: state.setSending,
    setSendError: state.setSendError,
    setQuota: state.setQuota,
    onSent,
  });

  return {
    isDesktop,
    state,
    counts,
    shownProfiles,
    selectedProfile,
    historyRecords,
    handleCopy,
    handleSend,
  };
}

function OutreachModalBody({
  c,
}: {
  readonly c: ReturnType<typeof useDesktopOutreachController>;
}) {
  return (
    <main className="career-outreach-body">
      <OutreachQuotaBanner quota={c.state.quota} />
      <OutreachFilterTabs
        activeFilter={c.state.filter}
        counts={c.counts}
        onSelect={c.state.setFilter}
      />
      <div className="career-outreach-list" role="region" aria-label="Список контактов">
        {c.shownProfiles.map((p) => (
          <DecisionMakerCard
            key={p.id}
            profile={p}
            isSelected={p.id === c.state.selectedId}
            onSelect={() => c.state.setSelectedId(p.id)}
          />
        ))}
      </div>
      <OutreachNoteForm
        isDesktop={c.isDesktop}
        selectedProfile={c.selectedProfile}
        note={c.state.note}
        onNoteChange={c.state.setNote}
        onCopy={c.handleCopy}
        copied={c.state.copied}
        onSend={c.handleSend}
        sending={c.state.sending}
        sendError={c.state.sendError}
        quotaAllowed={canSendInvite().allowed}
      />
      <OutreachRecordsHistory records={c.historyRecords} />
    </main>
  );
}

export function DesktopOutreachModal(props: DesktopOutreachModalProps) {
  const { isOpen, onClose, vacancy } = props;
  const cardRef = useRef<HTMLDivElement>(null);
  const c = useDesktopOutreachController(props, cardRef);

  if (!isOpen) return null;

  return (
    <div
      className="career-outreach-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (!cardRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        className="career-outreach-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="career-outreach-modal-title"
        tabIndex={-1}
        ref={cardRef}
      >
        <OutreachHeader
          company={vacancy.company}
          vacancyTitle={vacancy.title}
          isDesktop={c.isDesktop}
          onClose={onClose}
        />
        <OutreachModalBody c={c} />
      </div>
    </div>
  );
}
