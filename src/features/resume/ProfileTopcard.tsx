import { useState } from 'react';
import {
  CheckCircle,
  EnvelopeSimple,
  Globe,
  LinkedinLogo,
  MapPin,
  PaperPlaneTilt,
  PencilSimple,
  Phone,
} from '@phosphor-icons/react';
import type { ImportedSource } from './resumeSourceCoverage';
import { patchTopcard } from './profileEditing';
import type { ResumeDraft } from './resumeTypes';

interface ProfileTopcardProps {
  readonly draft: ResumeDraft;
  readonly importedSource?: ImportedSource;
  readonly updatedAt?: string;
  readonly onDraftChange: (draft: ResumeDraft) => void;
}

/**
 * Photo comes from a cached-media reference (B265 §4): the endpoint serves
 * bytes only to the owning session, so a plain `<img src>` with the app's
 * cookie is enough — no signed URL, no client-side blob juggling.
 */
function TopcardAvatar({ draft }: { readonly draft: ResumeDraft }) {
  const mediaId = draft.candidate.photoMediaId;
  const initials = initialsOf(draft.candidate.fullName);
  if (mediaId) {
    return (
      <img
        className="career-profile-screen-avatar"
        src={`/api/v1/candidate/media/${encodeURIComponent(mediaId)}`}
        alt=""
        width={96}
        height={96}
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

export function ProfileTopcard({
  draft,
  importedSource,
  updatedAt,
  onDraftChange,
}: ProfileTopcardProps) {
  const fullName = draft.candidate.fullName?.trim();
  const headline = draft.candidate.headline?.trim() ?? draft.targetRole?.trim();
  const location = draft.candidate.contact?.location?.trim();
  return (
    <section className="career-profile-screen-topcard" aria-label="Основные данные профиля">
      <div className="career-profile-screen-id-row">
        <TopcardAvatar draft={draft} />
        <div className="career-profile-screen-id-main">
          <div className="career-profile-screen-name-row">
            <h1>{fullName || 'Имя не указано'}</h1>
            {importedSource ? (
              <span className="career-profile-screen-tag is-accent">
                <CheckCircle size={13} weight="fill" />
                Импортировано · {importedSource.label}
              </span>
            ) : null}
          </div>
          {headline ? <p className="career-profile-screen-headline">{headline}</p> : null}
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
        <TopcardEdit draft={draft} onDraftChange={onDraftChange} />
      </div>
    </section>
  );
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
