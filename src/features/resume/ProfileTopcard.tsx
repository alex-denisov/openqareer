import { useState } from 'react';
import {
  CaretDown,
  CheckCircle,
  EnvelopeSimple,
  Globe,
  LinkedinLogo,
  MapPin,
  PaperPlaneTilt,
  PencilSimple,
  Phone,
  PlugsConnected,
} from '@phosphor-icons/react';
import { useCandidateMediaSrc } from './candidateMediaSrc';
import { resumeSourceCoverage, type ImportedSource } from './resumeSourceCoverage';
import { patchTopcard } from './profileEditing';
import { ProfileSearchConsentRow } from './ProfileSearchConsentRow';
import type { ResumeDraft, ResumeReaderProvenance } from './resumeTypes';
import type { SearchConsentState } from '../../../shared/searchConsent';
import type { CandidateConnection } from '../coach/coachApi';
import { CONNECTION_PLATFORMS, PLATFORM_LABELS } from '../connections/platformLabels';

interface ProfileTopcardProps {
  readonly draft: ResumeDraft;
  readonly importedSource?: ImportedSource;
  readonly updatedAt?: string;
  readonly reader: ResumeReaderProvenance | null;
  readonly onDraftChange: (draft: ResumeDraft) => void;
  /** Undefined while the status read has not landed yet (B266 pattern). */
  readonly connections?: readonly CandidateConnection[];
  /** Opens «Аккаунт → Подключения» (C54 п.11) — no chip without it. */
  readonly onOpenConnections?: () => void;
  readonly searchConsent?: SearchConsentState | null;
  readonly onSearchConsentChange?: (consent: SearchConsentState) => void;
}

/**
 * Photo comes from a cached-media reference (B265 §4), served only to the
 * owning session; `useCandidateMediaSrc` picks the form the runtime can read.
 */
function TopcardAvatar({ draft }: { readonly draft: ResumeDraft }) {
  const src = useCandidateMediaSrc(draft.candidate.photoMediaId);
  const [broken, setBroken] = useState(false);
  const initials = initialsOf(draft.candidate.fullName);
  if (src && !broken) {
    return (
      <img
        className="career-profile-screen-avatar"
        src={src}
        onError={() => setBroken(true)}
        alt=""
        width={64}
        height={64}
      />
    );
  }
  return (
    <span className="career-profile-screen-avatar" aria-hidden="true">
      {initials}
    </span>
  );
}

function initialsOf(fullName?: string): string {
  const parts = (fullName ?? '').trim().split(/\s+/u).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function ContactRow({ draft }: { readonly draft: ResumeDraft }) {
  const contact = draft.candidate.contact;
  const items: { icon: typeof EnvelopeSimple; label: string; href?: string }[] = [];
  if (contact?.email) {
    items.push({
      icon: EnvelopeSimple,
      label: `Email: ${contact.email}`,
      href: `mailto:${contact.email}`,
    });
  }
  if (contact?.phone) {
    items.push({ icon: Phone, label: `Телефон: ${contact.phone}`, href: `tel:${contact.phone}` });
  }
  if (contact?.telegram) {
    const handle = contact.telegram.replace(/^@/u, '');
    items.push({
      icon: PaperPlaneTilt,
      label: `Telegram: ${contact.telegram}`,
      href: `https://t.me/${handle}`,
    });
  }
  const site = contact?.links?.[0];
  if (site) {
    items.push({
      icon: Globe,
      label: `Сайт: ${site}`,
      href: site.startsWith('http') ? site : `https://${site}`,
    });
  }
  if (contact?.linkedinUrl) {
    items.push({ icon: LinkedinLogo, label: 'Профиль LinkedIn', href: contact.linkedinUrl });
  }
  if (!items.length) return null;
  return (
    <div className="career-profile-screen-contact-row" role="group" aria-label="Контакты">
      {items.map((item) => (
        <a
          key={item.label}
          className="career-profile-screen-contact-icon"
          href={item.href}
          title={item.label}
          aria-label={item.label}
        >
          <item.icon size={16} />
        </a>
      ))}
    </div>
  );
}

// eslint-disable-next-line max-lines-per-function
function TopcardEditForm({
  draft,
  onSave,
  onCancel,
}: {
  readonly draft: ResumeDraft;
  readonly onSave: (patch: Parameters<typeof patchTopcard>[1]) => void;
  readonly onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(draft.candidate.fullName ?? '');
  const [headline, setHeadline] = useState(draft.candidate.headline ?? '');
  const [location, setLocation] = useState(draft.candidate.contact?.location ?? '');
  const [email, setEmail] = useState(draft.candidate.contact?.email ?? '');
  const [phone, setPhone] = useState(draft.candidate.contact?.phone ?? '');
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Имя</span>
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Роль (headline)</span>
          <input value={headline} onChange={(event) => setHeadline(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Город</span>
          <input value={location} onChange={(event) => setLocation(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="career-profile-screen-field">
          <span>Телефон</span>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
      </div>
      <div className="career-profile-screen-edit-actions">
        <button type="button" className="career-quiet-button" onClick={onCancel}>
          Отменить
        </button>
        <button
          type="button"
          className="career-primary-button"
          onClick={() => onSave({ fullName, headline, location, email, phone })}
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}

/**
 * Edit-in-place, never a redirect to account settings (B265 §4 remark 7) —
 * a `<details>` disclosure mirrors the mockup's own choice for the same
 * reason: no route change, no lost scroll position.
 */
function TopcardEdit({
  draft,
  onDraftChange,
}: {
  readonly draft: ResumeDraft;
  readonly onDraftChange: (draft: ResumeDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="career-quiet-button" onClick={() => setOpen(true)}>
        <PencilSimple size={15} />
        Изменить
      </button>
    );
  }
  return (
    <TopcardEditForm
      draft={draft}
      onCancel={() => setOpen(false)}
      onSave={(patch) => {
        onDraftChange(patchTopcard(draft, patch));
        setOpen(false);
      }}
    />
  );
}

/**
 * "Источник профиля" used to be a whole side-rail card, always open
 * (`SourceCoveragePanel`, pre-C54); the owner called it excessive and in the
 * way — folded into one line here, the full filled/empty list opens only on
 * click (C54 п.5, `<details>`, never an always-open card).
 */
function SourceCoverageChip({
  draft,
  importedSource,
}: {
  readonly draft: ResumeDraft;
  readonly importedSource?: ImportedSource;
}) {
  const coverage = resumeSourceCoverage(draft);
  const total = coverage.filled.length + coverage.empty.length;
  return (
    <details className="career-profile-screen-source-chip">
      <summary>
        <CheckCircle size={13} weight="fill" />
        {importedSource ? `Импортировано из ${importedSource.label}` : 'Источник профиля'} ·{' '}
        {coverage.filled.length}/{total}
        <CaretDown size={12} />
      </summary>
      <ul className="career-profile-screen-coverage">
        {coverage.filled.map((section) => (
          <li key={section.id}>
            <span>{section.label}</span>
            <span>заполнено</span>
          </li>
        ))}
        {coverage.empty.map((section) => (
          <li key={section.id} className="is-missing">
            <span>{section.label}</span>
            <span>не заполнено</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function connectionStatusLabel(status: CandidateConnection['status'] | undefined): string {
  return status === 'connected' ? 'Подключено' : 'Не подключено';
}

/**
 * Two chips, hh.ru and LinkedIn, visible on the profile itself without a
 * trip to settings (C54 п.11, owner remark). Both click through to the same
 * `AccountConnectionsManager` the settings drawer already renders — this
 * component never re-implements connect/disconnect.
 */
function ConnectionStatusChips({
  connections,
  onOpenConnections,
}: {
  readonly connections?: readonly CandidateConnection[];
  readonly onOpenConnections: () => void;
}) {
  return (
    <>
      {CONNECTION_PLATFORMS.map((platform) => {
        const found = connections?.find((connection) => connection.platform === platform);
        const connected = found?.status === 'connected';
        return (
          <button
            key={platform}
            type="button"
            className={`career-profile-screen-tag career-profile-screen-connection-chip${
              connected ? ' is-accent' : ''
            }`}
            onClick={onOpenConnections}
          >
            <PlugsConnected size={13} />
            {PLATFORM_LABELS[platform]} — {connectionStatusLabel(found?.status)}
          </button>
        );
      })}
    </>
  );
}

export function ProfileTopcard(props: ProfileTopcardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { draft, updatedAt, onDraftChange } = props;
  const fullName = draft.candidate.fullName?.trim();
  const headline = draft.candidate.headline?.trim() ?? draft.targetRole?.trim();
  const location = draft.candidate.contact?.location?.trim();
  const hasDetails = Boolean(location || updatedAt || draft.candidate.contact);

  return (
    <section className="career-profile-screen-topcard" aria-label="Основные данные профиля">
      <div className="career-profile-screen-id-row">
        <TopcardAvatar draft={draft} />
        <div className="career-profile-screen-id-main">
          <div className="career-profile-screen-name-row">
            <h1>{fullName || 'Имя не указано'}</h1>
          </div>
          {headline ? <p className="career-profile-screen-headline">{headline}</p> : null}
          <ProfileStatusRow props={props} />
          {hasDetails ? (
            <ProfileDetailsToggle
              isOpen={detailsOpen}
              onToggle={() => setDetailsOpen((prev) => !prev)}
            />
          ) : null}
          <ProfileTopcardDetails
            isOpen={detailsOpen}
            location={location}
            updatedAt={updatedAt}
            draft={draft}
          />
          <ProfileSearchConsentRow
            initialConsent={props.searchConsent}
            onConsentChange={props.onSearchConsentChange}
          />
        </div>
        <TopcardEdit draft={draft} onDraftChange={onDraftChange} />
      </div>
    </section>
  );
}

function ProfileDetailsToggle({
  isOpen,
  onToggle,
}: {
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="career-profile-screen-details-toggle"
      aria-expanded={isOpen}
      onClick={onToggle}
    >
      <span>{isOpen ? 'Скрыть' : 'Подробнее'}</span>
      <CaretDown
        size={14}
        aria-hidden="true"
        style={{
          transform: isOpen ? 'rotate(180deg)' : undefined,
          transition: 'transform 160ms ease',
        }}
      />
    </button>
  );
}

function ProfileTopcardDetails({
  isOpen,
  location,
  updatedAt,
  draft,
}: {
  readonly isOpen: boolean;
  readonly location?: string;
  readonly updatedAt?: string;
  readonly draft: ResumeDraft;
}) {
  return (
    <div className={`career-profile-screen-details${isOpen ? ' is-open' : ''}`}>
      <div className="career-profile-screen-id-meta">
        {location ? (
          <span>
            <MapPin size={14} />
            {location}
          </span>
        ) : null}
        {updatedAt ? (
          <span>
            <CheckCircle size={14} />
            Обновлено {formatDate(updatedAt)}
          </span>
        ) : null}
      </div>
      <ContactRow draft={draft} />
    </div>
  );
}

function ProfileStatusRow({ props }: { readonly props: ProfileTopcardProps }) {
  return (
    <div className="career-profile-screen-status-row">
      <SourceCoverageChip draft={props.draft} importedSource={props.importedSource} />
      {props.reader ? (
        <span className="career-profile-screen-reader-status">{readerLabel(props.reader)}</span>
      ) : null}
      {props.onOpenConnections ? (
        <ConnectionStatusChips
          connections={props.connections}
          onOpenConnections={props.onOpenConnections}
        />
      ) : null}
    </div>
  );
}

function readerLabel(reader: ResumeReaderProvenance): string {
  return reader.method === 'rules' ? 'Прочитано правилами' : 'Прочитано моделью';
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}
