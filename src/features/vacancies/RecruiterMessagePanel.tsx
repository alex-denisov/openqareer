import { useEffect, useState } from 'react';
import { ArrowSquareOut, Check, CircleNotch, Copy, X } from '@phosphor-icons/react';
import { requestVacancyPitch } from './vacancyPitchApi';

export interface RecruiterMessageContact {
  readonly vacancyId: string;
  readonly fullName: string;
  readonly roleTitle: string;
  readonly email: string | null;
  readonly telegram: string | null;
  readonly whatsapp: string | null;
  readonly linkedinUrl: string | null;
}

export interface RecruiterMessagePanelProps {
  readonly contact: RecruiterMessageContact;
  readonly defaultSubject?: string;
  readonly onClose?: () => void;
}

export interface ContactChannel {
  readonly label: string;
  readonly href: string;
  readonly target?: string;
}

export function resolveContactChannels(
  contact: RecruiterMessageContact,
  subject: string,
  body: string,
): readonly ContactChannel[] {
  const channels: ContactChannel[] = [];
  if (contact.email) {
    const mailto = `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    channels.push({ label: 'почте', href: mailto });
  }
  if (contact.telegram) {
    const handle = contact.telegram.replace(/^@/, '');
    const tgHref = contact.telegram.startsWith('http')
      ? contact.telegram
      : `https://t.me/${handle}`;
    channels.push({ label: 'Telegram', href: tgHref, target: '_blank' });
  }
  if (contact.linkedinUrl) {
    channels.push({ label: 'LinkedIn', href: contact.linkedinUrl, target: '_blank' });
  }
  if (contact.whatsapp) {
    const waDigits = contact.whatsapp.replace(/\D/g, '');
    const waHref = contact.whatsapp.startsWith('http')
      ? contact.whatsapp
      : `https://wa.me/${waDigits}?text=${encodeURIComponent(body)}`;
    channels.push({ label: 'WhatsApp', href: waHref, target: '_blank' });
  }
  return channels;
}

function ChannelButtons({ channels }: { readonly channels: readonly ContactChannel[] }) {
  return (
    <>
      {channels.map((channel) => (
        <a
          key={channel.label}
          href={channel.href}
          target={channel.target}
          rel={channel.target ? 'noreferrer' : undefined}
          className="career-recruiter-message-channel-btn"
        >
          <ArrowSquareOut size={13} aria-hidden="true" />
          <span>Открыть в {channel.label}</span>
        </a>
      ))}
    </>
  );
}

function CopyButton({ message }: { readonly message: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) {
      setState('failed');
      return;
    }
    clipboard.writeText(message).then(
      () => {
        setState('copied');
        setTimeout(() => setState('idle'), 2000);
      },
      () => setState('failed'),
    );
  };
  const copied = state === 'copied';

  return (
    <button type="button" className="career-recruiter-message-copy-btn" onClick={handleCopy}>
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span>
        {copied
          ? 'Скопировано'
          : state === 'failed'
            ? 'Не скопировалось — выделите текст'
            : 'Скопировать'}
      </span>
    </button>
  );
}

function useRecruiterMessage(contact: RecruiterMessageContact) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [evidenceCount, setEvidenceCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    requestVacancyPitch(contact.vacancyId, {
      recipient: {
        name: contact.fullName,
        role: contact.roleTitle,
      },
    })
      .then((res) => {
        if (!active) return;
        const msg = res.contactMessage ?? res.linkedInNote ?? '';
        setMessage(msg);
        setEvidenceCount(res.usedEvidenceIds?.length ?? 0);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Не удалось подготовить сообщение.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [contact.vacancyId, contact.fullName, contact.roleTitle]);

  return { loading, error, message, evidenceCount };
}

function MessageFooter({
  message,
  evidenceCount,
  channels,
}: {
  readonly message: string;
  readonly evidenceCount: number;
  readonly channels: readonly ContactChannel[];
}) {
  return (
    <div className="career-recruiter-message-footer">
      {evidenceCount > 0 && (
        <span className="career-recruiter-message-evidence-badge">
          {evidenceCount === 1 ? '1 факт из профиля' : `${evidenceCount} факта из профиля`}
        </span>
      )}
      <div className="career-recruiter-message-actions">
        <CopyButton message={message} />
        <ChannelButtons channels={channels} />
      </div>
    </div>
  );
}

export function RecruiterMessagePanel({
  contact,
  defaultSubject = 'Отклик на вакансию',
  onClose,
}: RecruiterMessagePanelProps) {
  const { loading, error, message, evidenceCount } = useRecruiterMessage(contact);
  const channels = resolveContactChannels(contact, defaultSubject, message);

  return (
    <div
      className="career-recruiter-message-panel"
      role="region"
      aria-label="Сообщение нанимающему"
    >
      <div className="career-recruiter-message-header">
        <span className="career-recruiter-message-title">Сообщение для {contact.fullName}</span>
        {onClose && (
          <button
            type="button"
            className="career-recruiter-message-close-btn"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {loading && (
        <div className="career-recruiter-message-loading">
          <CircleNotch size={16} className="career-spin" aria-hidden="true" />
          <span>Готовим сообщение по профилю…</span>
        </div>
      )}

      {error && (
        <div className="career-recruiter-message-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && message && (
        <>
          <p className="career-recruiter-message-text">{message}</p>
          <MessageFooter message={message} evidenceCount={evidenceCount} channels={channels} />
        </>
      )}
    </div>
  );
}
