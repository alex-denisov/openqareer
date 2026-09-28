import { useCallback, useEffect, useState } from 'react';
import {
  AddressBook,
  ArrowSquareOut,
  Chats,
  CircleNotch,
  Copy,
  EnvelopeSimple,
  PaperPlaneTilt,
  Phone,
  User,
} from '@phosphor-icons/react';
import type { EmailStatus, RecruiterContact } from '../../../shared/recruiterContact';
import { SEARCH_CONSENT_TEXT } from '../../../shared/searchConsent';
import { CareerTooltip } from '../shell/CareerTooltip';
import { CoachApiError } from '../coach/apiClient';
import {
  enrichRecruiterContacts,
  getRecruiterContacts,
  grantSearchConsent,
  type RecruiterContactsResponse,
  type EnrichVacancyPayload,
} from './recruiterContactsApi';
import type { RecruiterContactJob } from '../../../shared/recruiterContact';
import { RecruiterMessagePanel } from './RecruiterMessagePanel';

export interface RecruiterContactsBlockProps {
  readonly vacancyId: string;
  readonly vacancyPayload?: EnrichVacancyPayload;
  readonly initialContacts?: readonly RecruiterContact[];
  readonly searched?: boolean;
  readonly onContactsLoaded?: (contacts: RecruiterContact[]) => void;
}

/**
 * Бейдж — про адрес, а не про человека: «Проверен» читался как «проверенный
 * рекрутер» (B236 §5.3). Тултип говорит, стоит ли писать на гипотезу.
 */
const EMAIL_STATUS_COPY: Record<EmailStatus, { label: string; hint: string }> = {
  verified: { label: 'Почта проверена', hint: 'Адрес подтверждён почтовым сервером' },
  hypothesis: {
    label: 'Почта — гипотеза',
    hint: 'Собран по шаблону компании — может не существовать',
  },
  unverified: { label: 'Почта не проверена', hint: 'Проверить не удалось' },
};

function ContactBadge({ status }: { readonly status: EmailStatus }) {
  const copy = EMAIL_STATUS_COPY[status];

  return (
    <CareerTooltip content={copy.hint}>
      <span className="career-recruiter-badge" data-status={status} role="status">
        {copy.label}
      </span>
    </CareerTooltip>
  );
}

function EmailAction({ email }: { readonly email: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="career-recruiter-email-wrap">
      <a href={`mailto:${email}`} className="career-recruiter-link" title="Написать письмо">
        <EnvelopeSimple size={15} aria-hidden="true" />
        <span>{email}</span>
      </a>
      <button
        type="button"
        className="career-recruiter-copy-btn"
        onClick={handleCopy}
        title="Скопировать адрес"
        aria-label="Скопировать адрес"
      >
        <Copy size={13} aria-hidden="true" />
        {copied && <span className="career-recruiter-copied">Адрес скопирован</span>}
      </button>
    </div>
  );
}

function contactHrefs(contact: RecruiterContact) {
  return {
    tgHref: contact.telegram?.startsWith('http')
      ? contact.telegram
      : `https://t.me/${contact.telegram?.replace(/^@/, '')}`,
    waHref: contact.whatsapp?.startsWith('http')
      ? contact.whatsapp
      : `https://wa.me/${contact.whatsapp?.replace(/\D/g, '')}`,
    phoneHref: `tel:${contact.phone?.replace(/[^\d+]/g, '')}`,
  };
}

function SocialActions({ contact }: { readonly contact: RecruiterContact }) {
  const { tgHref, waHref, phoneHref } = contactHrefs(contact);

  return (
    <>
      {contact.telegram && (
        <a href={tgHref} target="_blank" rel="noreferrer" className="career-recruiter-link">
          <PaperPlaneTilt size={15} aria-hidden="true" />
          <span>{contact.telegram}</span>
        </a>
      )}
      {contact.whatsapp && (
        <a href={waHref} target="_blank" rel="noreferrer" className="career-recruiter-link">
          <Chats size={15} aria-hidden="true" />
          <span>WhatsApp</span>
        </a>
      )}
      {contact.phone && (
        <a href={phoneHref} className="career-recruiter-link">
          <Phone size={15} aria-hidden="true" />
          <span>{contact.phone}</span>
        </a>
      )}
      {contact.linkedinUrl && (
        <a
          href={contact.linkedinUrl}
          target="_blank"
          rel="noreferrer"
          className="career-recruiter-link"
        >
          <span>LinkedIn</span>
          <ArrowSquareOut size={13} aria-hidden="true" />
        </a>
      )}
      {contact.githubUrl && (
        <a
          href={contact.githubUrl}
          target="_blank"
          rel="noreferrer"
          className="career-recruiter-link"
        >
          <span>GitHub</span>
          <ArrowSquareOut size={13} aria-hidden="true" />
        </a>
      )}
    </>
  );
}

function RecruiterCard({ contact }: { readonly contact: RecruiterContact }) {
  const [showMessage, setShowMessage] = useState(false);

  return (
    <div className="career-recruiter-card">
      <div className="career-recruiter-header">
        <div className="career-recruiter-person">
          <User size={18} className="career-recruiter-icon" aria-hidden="true" />
          <div>
            <strong>{contact.fullName}</strong>
            <small>{contact.roleTitle}</small>
          </div>
        </div>
        <ContactBadge status={contact.emailStatus} />
      </div>
      <div className="career-recruiter-actions">
        <button
          type="button"
          className="career-recruiter-write-btn"
          onClick={() => setShowMessage((prev) => !prev)}
          aria-expanded={showMessage}
        >
          <PaperPlaneTilt size={14} aria-hidden="true" />
          <span>Написать</span>
        </button>
        {contact.email && <EmailAction email={contact.email} />}
        <SocialActions contact={contact} />
      </div>
      {showMessage && (
        <RecruiterMessagePanel
          contact={contact}
          onClose={() => setShowMessage(false)}
        />
      )}
    </div>
  );
}

function EmptyContactsNotice({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="career-recruiter-empty">
      <span>
        Рекрутер или hiring manager в открытых источниках не нашлись. Попробуйте «Нетворкинг» —
        знакомый в компании заменяет контакт.
      </span>
      <button type="button" className="career-recruiter-retry-btn" onClick={onRetry}>
        Искать ещё раз
      </button>
    </div>
  );
}

function ErrorContactsNotice({
  error,
  onRetry,
}: {
  readonly error: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="career-recruiter-error" role="alert">
      <span>{error}</span>
      <button type="button" className="career-recruiter-retry-btn" onClick={onRetry}>
        Попробовать ещё раз
      </button>
    </div>
  );
}

const CONSENT_REQUIRED_CODE = 'search_consent_required';

function isConsentRequired(reason: unknown): boolean {
  return reason instanceof CoachApiError && reason.code === CONSENT_REQUIRED_CODE;
}

/** Без согласия сервер отказывает; вместо ошибки кандидат видит, на что соглашается. */
function ConsentRequiredNotice({ onGrant }: { readonly onGrant: () => void }) {
  return (
    <div className="career-recruiter-empty">
      <span>{SEARCH_CONSENT_TEXT}</span>
      <button type="button" className="career-recruiter-retry-btn" onClick={onGrant}>
        Разрешить и найти
      </button>
    </div>
  );
}

interface EnrichSink {
  readonly setContacts: (contacts: readonly RecruiterContact[]) => void;
  readonly setJob: (job: RecruiterContactJob | null) => void;
  readonly setHasSearched: (searched: boolean) => void;
}

/** Запуск поиска и согласие «Вы в поиске», без которого сервер отказывает (C59). */
function useEnrichAction(
  vacancyId: string,
  sink: EnrichSink,
  onContactsLoaded?: (contacts: RecruiterContact[]) => void,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentRequired, setConsentRequired] = useState(false);
  const { setContacts, setJob, setHasSearched } = sink;

  const handleEnrich = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await enrichRecruiterContacts(vacancyId);
      setContacts(result.contacts);
      setJob(result.job);
      setHasSearched(result.job?.status === 'ready');
      if (result.job?.status === 'ready') onContactsLoaded?.(result.contacts);
    } catch (err) {
      if (isConsentRequired(err)) setConsentRequired(true);
      else setError(err instanceof Error ? err.message : 'Поиск не удался. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }, [vacancyId, onContactsLoaded, setContacts, setJob, setHasSearched]);

  const handleGrantConsent = useCallback(async () => {
    try {
      await grantSearchConsent();
      setConsentRequired(false);
      await handleEnrich();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить согласие.');
    }
  }, [handleEnrich]);

  return { loading, error, setError, consentRequired, handleEnrich, handleGrantConsent };
}

export function useRecruiterContacts({
  vacancyId,
  vacancyPayload: _vacancyPayload,
  initialContacts,
  initialSearched = false,
  onContactsLoaded,
}: {
  vacancyId: string;
  vacancyPayload?: EnrichVacancyPayload;
  initialContacts?: readonly RecruiterContact[];
  initialSearched?: boolean;
  onContactsLoaded?: (contacts: RecruiterContact[]) => void;
}) {
  const [contacts, setContacts] = useState<readonly RecruiterContact[]>(initialContacts ?? []);
  const [hasSearched, setHasSearched] = useState(
    initialSearched || Boolean(initialContacts?.length),
  );
  const [job, setJob] = useState<RecruiterContactJob | null>(null);
  const enrich = useEnrichAction(
    vacancyId,
    { setContacts, setJob, setHasSearched },
    onContactsLoaded,
  );

  const refreshState = useCallback(async (): Promise<RecruiterContactsResponse> => {
    const result = await getRecruiterContacts(vacancyId);
    setContacts(result.contacts);
    setJob(result.job);
    if (result.job?.status === 'ready' || result.job?.status === 'failed') {
      setHasSearched(true);
    }
    return result;
  }, [vacancyId]);

  useRecruiterContactJobPolling(job, refreshState, enrich.setError);

  return {
    contacts,
    hasSearched,
    loading: enrich.loading,
    error: enrich.error,
    job,
    consentRequired: enrich.consentRequired,
    handleEnrich: enrich.handleEnrich,
    handleGrantConsent: enrich.handleGrantConsent,
  };
}

function useRecruiterContactJobPolling(
  job: RecruiterContactJob | null,
  refreshState: () => Promise<RecruiterContactsResponse>,
  setError: (error: string | null) => void,
): void {
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return undefined;
    const timer = window.setInterval(() => {
      void refreshState().catch((reason) => {
        setError(
          reason instanceof Error ? reason.message : 'Не удалось обновить состояние поиска.',
        );
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [job, refreshState, setError]);
}

export type RecruiterContactsState = ReturnType<typeof useRecruiterContacts>;

/**
 * Кнопка «Рекрутер» стоит в одном ряду с остальными действиями строки (B236
 * §4.4): отдельная строка «Найти прямые контакты» удваивала высоту каждой из
 * двадцати строк. Результат поиска раскрывается под строкой.
 */
export function RecruiterContactsTrigger({
  state,
  className = 'career-recruiter-btn',
}: {
  readonly state: RecruiterContactsState;
  readonly className?: string;
}) {
  if (
    state.loading ||
    state.error ||
    state.consentRequired ||
    state.job?.status === 'queued' ||
    state.job?.status === 'running' ||
    state.hasSearched ||
    state.contacts.length > 0
  ) {
    return null;
  }
  return (
    <CareerTooltip content="Найти того, кто ведёт вакансию. Почта будет отмечена как проверенная или гипотеза.">
      <button type="button" className={className} onClick={state.handleEnrich}>
        <AddressBook size={14} aria-hidden="true" />
        <span>Рекрутер</span>
      </button>
    </CareerTooltip>
  );
}

export function RecruiterContactsResults({ state }: { readonly state: RecruiterContactsState }) {
  const { contacts, hasSearched, loading, error, job, handleEnrich } = state;

  if (state.consentRequired && !loading && !error) {
    return <ConsentRequiredNotice onGrant={() => void state.handleGrantConsent()} />;
  }

  if (loading || job?.status === 'queued' || job?.status === 'running') {
    return (
      <div className="career-recruiter-loading" aria-busy="true">
        <CircleNotch size={18} className="career-spin" aria-hidden="true" />
        <span>
          {job?.status === 'queued' ? 'Запрос поставлен в очередь…' : 'Ищем, кто ведёт вакансию…'}
        </span>
      </div>
    );
  }

  if (error || job?.status === 'failed') {
    return (
      <ErrorContactsNotice
        error={error ?? 'Поиск контактов не завершился. Попробуйте ещё раз.'}
        onRetry={handleEnrich}
      />
    );
  }
  if (hasSearched && contacts.length === 0) return <EmptyContactsNotice onRetry={handleEnrich} />;
  if (contacts.length > 0) {
    return (
      <div className="career-recruiter-list">
        {contacts.map((contact) => (
          <RecruiterCard key={contact.id} contact={contact} />
        ))}
      </div>
    );
  }
  return null;
}

/** Кнопка и результат вместе — для витрин и мест вне строки вакансии. */
export function RecruiterContactsBlock({
  vacancyId,
  vacancyPayload,
  initialContacts,
  searched: initialSearched = false,
  onContactsLoaded,
}: RecruiterContactsBlockProps) {
  const state = useRecruiterContacts({
    vacancyId,
    vacancyPayload,
    initialContacts,
    initialSearched,
    onContactsLoaded,
  });

  return (
    <>
      <RecruiterContactsTrigger state={state} />
      <RecruiterContactsResults state={state} />
    </>
  );
}
