import { useCallback, useState } from 'react';
import {
  ArrowSquareOut,
  Chats,
  CircleNotch,
  Copy,
  EnvelopeSimple,
  MagnifyingGlass,
  PaperPlaneTilt,
  Phone,
  User,
} from '@phosphor-icons/react';
import type { EmailStatus, RecruiterContact } from '../../../shared/recruiterContact';
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

function ContactBadge({ status }: { readonly status: EmailStatus }) {
  const label =
    status === 'verified'
      ? 'Проверен'
      : status === 'hypothesis'
        ? 'Гипотеза'
        : 'Не подтверждён';

  return (
    <span
      className="career-recruiter-badge"
      data-status={status}
      role="status"
    >
      {label}
    </span>
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
        title="Написать на почту"
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
        {copied && <span className="career-recruiter-copied">Скопировано</span>}
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
      <span>Прямые контакты в открытых источниках не найдены.</span>
      <button type="button" className="career-recruiter-retry-btn" onClick={onRetry}>
        Повторить поиск
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
        Повторить
      </button>
    </div>
  );
}

function useRecruiterContacts({
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
      setError(err instanceof Error ? err.message : 'Сбой при поиске контактов');
    } finally {
      setLoading(false);
    }
  }, [vacancyId, onContactsLoaded]);

  return { contacts, hasSearched, loading, error, handleEnrich };
}

export function RecruiterContactsBlock({
  vacancyId,
  vacancyPayload,
  initialContacts,
  searched: initialSearched = false,
  onContactsLoaded,
}: RecruiterContactsBlockProps) {
  const { contacts, hasSearched, loading, error, handleEnrich } = useRecruiterContacts({
    vacancyId,
    vacancyPayload,
    initialContacts,
    initialSearched,
    onContactsLoaded,
  });

  if (loading) {
    return (
      <div className="career-recruiter-loading" aria-busy="true">
        <CircleNotch size={18} className="career-spin" aria-hidden="true" />
        <span>Ищем прямые контакты...</span>
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

  return (
    <button type="button" className="career-recruiter-btn" onClick={handleEnrich}>
      <MagnifyingGlass size={15} aria-hidden="true" />
      <span>Найти прямые контакты</span>
    </button>
  );
}
