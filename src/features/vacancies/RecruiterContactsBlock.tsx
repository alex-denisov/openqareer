import { useCallback, useState } from 'react';
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
import { CareerTooltip } from '../shell/CareerTooltip';
import {
  enrichRecruiterContacts,
  type EnrichVacancyPayload,
} from './recruiterContactsApi';

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
      <a
        href={`mailto:${email}`}
        className="career-recruiter-link"
        title="Написать письмо"
      >
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

function SocialActions({ contact }: { readonly contact: RecruiterContact }) {
  const tgHref = contact.telegram?.startsWith('http')
    ? contact.telegram
    : `https://t.me/${contact.telegram?.replace(/^@/, '')}`;

  const waHref = contact.whatsapp?.startsWith('http')
    ? contact.whatsapp
    : `https://wa.me/${contact.whatsapp?.replace(/\D/g, '')}`;

  const phoneHref = `tel:${contact.phone?.replace(/[^\d+]/g, '')}`;

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
        <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="career-recruiter-link">
          <span>LinkedIn</span>
          <ArrowSquareOut size={13} aria-hidden="true" />
        </a>
      )}
      {contact.githubUrl && (
        <a href={contact.githubUrl} target="_blank" rel="noreferrer" className="career-recruiter-link">
          <span>GitHub</span>
          <ArrowSquareOut size={13} aria-hidden="true" />
        </a>
      )}
    </>
  );
}

function RecruiterCard({ contact }: { readonly contact: RecruiterContact }) {
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
        {contact.email && <EmailAction email={contact.email} />}
        <SocialActions contact={contact} />
      </div>
    </div>
  );
}

function EmptyContactsNotice({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="career-recruiter-empty">
      <span>
        Рекрутер или hiring manager в открытых источниках не нашлись. Попробуйте
        «Нетворкинг» — знакомый в компании заменяет контакт.
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
  const [hasSearched, setHasSearched] = useState(initialSearched || Boolean(initialContacts?.length));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnrich = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await enrichRecruiterContacts(vacancyId);
      setContacts(result);
      setHasSearched(true);
      onContactsLoaded?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Поиск не удался. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }, [vacancyId, onContactsLoaded]);

  return { contacts, hasSearched, loading, error, handleEnrich };
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
  if (state.loading || state.error || state.hasSearched || state.contacts.length > 0) {
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
  const { contacts, hasSearched, loading, error, handleEnrich } = state;

  if (loading) {
    return (
      <div className="career-recruiter-loading" aria-busy="true">
        <CircleNotch size={18} className="career-spin" aria-hidden="true" />
        <span>Ищем, кто ведёт вакансию…</span>
      </div>
    );
  }

  if (error) return <ErrorContactsNotice error={error} onRetry={handleEnrich} />;
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
