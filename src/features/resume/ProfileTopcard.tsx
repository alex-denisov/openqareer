import { useState } from 'react';
import {
  ArrowClockwise,
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
import { profileCompleteness } from './profileCompleteness';
import { patchTopcard } from './profileEditing';
import type { ResumeDraft, ResumeReaderProvenance } from './resumeTypes';
import type { CandidateConnection, ImportedSourceSummary } from '../coach/coachApi';
import { CONNECTION_PLATFORMS, PLATFORM_LABELS } from '../connections/platformLabels';

interface ProfileTopcardProps {
  readonly draft: ResumeDraft;
  readonly importedSource?: ImportedSource;
  readonly updatedAt?: string;
  readonly reader: ResumeReaderProvenance | null;
  readonly onDraftChange: (draft: ResumeDraft) => void;
  readonly onSectionSave?: (draft: ResumeDraft) => Promise<boolean | void> | boolean | void;
  readonly saving?: boolean;
  /** Undefined while the status read has not landed yet (B266 pattern). */
  readonly connections?: readonly CandidateConnection[];
  readonly importedSources?: readonly ImportedSourceSummary[];
  /** Opens «Аккаунт → Подключения» (C54 п.11) — no chip without it. */
  readonly onOpenConnections?: () => void;
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
  saving,
}: {
  readonly draft: ResumeDraft;
  readonly onSave: (
    patch: Parameters<typeof patchTopcard>[1],
  ) => Promise<boolean | void> | boolean | void;
  readonly onCancel: () => void;
  readonly saving?: boolean;
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
          disabled={saving}
          onClick={() => void onSave({ fullName, headline, location, email, phone })}
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
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
  onSectionSave,
  saving,
}: {
  readonly draft: ResumeDraft;
  readonly onDraftChange: (draft: ResumeDraft) => void;
  readonly onSectionSave?: (draft: ResumeDraft) => Promise<boolean | void> | boolean | void;
  readonly saving?: boolean;
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
      saving={saving}
      onCancel={() => setOpen(false)}
      onSave={async (patch) => {
        const next = patchTopcard(draft, patch);
        const saved = onSectionSave ? await onSectionSave(next) : (onDraftChange(next), true);
        if (saved === false) return false;
        setOpen(false);
        return true;
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
function connectionStatusLabel(status: CandidateConnection['status'] | undefined): string {
  if (status === 'connected') return 'Подключено';
  if (status === 'imported') return 'Импортировано';
  if (status === 'disconnected') return 'Не подключено';
  return 'Не импортировано';
}

function factCountLabel(count: number): string {
  const rest100 = count % 100;
  const rest10 = count % 10;
  const noun =
    rest100 >= 11 && rest100 <= 14
      ? 'фактов'
      : rest10 === 1
        ? 'факт'
        : rest10 >= 2 && rest10 <= 4
          ? 'факта'
          : 'фактов';
  return `${count} ${noun}`;
}

function importDateLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(date);
  return parts.replace(/\.$/u, '');
}

function SourceChip({
  platform,
  imported,
  connection,
  onOpenConnections,
}: {
  readonly platform: (typeof CONNECTION_PLATFORMS)[number];
  readonly imported?: ImportedSourceSummary | ImportedSource;
  readonly connection?: CandidateConnection;
  readonly onOpenConnections?: () => void;
}) {
  const count =
    imported?.factCount ?? (connection?.status === 'connected' ? connection.factCount : undefined);
  const date = importDateLabel(
    imported && 'lastImportedAt' in imported
      ? imported.lastImportedAt
      : (imported?.importedAt ??
          (connection?.status === 'connected'
            ? connection.lastImportedAt
            : connection?.status === 'imported'
              ? connection.importedAt
              : undefined)),
  );
  const detail =
    count !== undefined
      ? [factCountLabel(count), date].filter(Boolean).join(' · ')
      : connectionStatusLabel(connection?.status);
  const contents = (
    <span className="career-profile-screen-source-visual">
      <span className="career-profile-screen-source-name">{PLATFORM_LABELS[platform]}</span>
      <span aria-hidden="true">·</span>
      <span className="career-profile-screen-source-detail">{detail}</span>
    </span>
  );

  return onOpenConnections ? (
    <button
      type="button"
      className="career-profile-screen-source-chip career-profile-screen-connection-chip"
      onClick={onOpenConnections}
      aria-label={`${PLATFORM_LABELS[platform]} · ${detail} · Управлять подключением`}
    >
      {contents}
    </button>
  ) : (
    <span className="career-profile-screen-source-chip">{contents}</span>
  );
}

function ProfileSourceActions({
  hasImports,
  onOpenConnections,
}: {
  readonly hasImports: boolean;
  readonly onOpenConnections?: () => void;
}) {
  if (!onOpenConnections) return null;
  return (
    <>
      <button
        className="career-profile-screen-source-add"
        type="button"
        onClick={onOpenConnections}
      >
        <PlugsConnected size={16} aria-hidden="true" />
        Источник
      </button>
      {hasImports ? (
        <button
          className="career-quiet-button career-profile-screen-import-again"
          type="button"
          onClick={onOpenConnections}
        >
          <ArrowClockwise size={15} aria-hidden="true" />
          Импортировать заново
        </button>
      ) : null}
    </>
  );
}

/** Source chips show import evidence and lead to the shared connection manager. */
function ConnectionStatusChips({
  connections,
  importedSources,
  importedSource,
  onOpenConnections,
}: {
  readonly connections?: readonly CandidateConnection[];
  readonly importedSources?: readonly ImportedSourceSummary[];
  readonly importedSource?: ImportedSource;
  readonly onOpenConnections?: () => void;
}) {
  const sources = importedSources ?? (importedSource ? [importedSource] : []);
  const hasImports = sources.length > 0;
  return (
    <div className="career-profile-screen-source-list" aria-label="Источники резюме">
      {CONNECTION_PLATFORMS.map((platform) => {
        const connection = connections?.find((entry) => entry.platform === platform);
        const imported = sources.find((entry) => entry.platform === platform);
        return (
          <SourceChip
            key={platform}
            platform={platform}
            imported={imported}
            connection={connection}
            onOpenConnections={onOpenConnections}
          />
        );
      })}
      <ProfileSourceActions hasImports={hasImports} onOpenConnections={onOpenConnections} />
    </div>
  );
}

function ProfileCoverageDetails({ draft }: { readonly draft: ResumeDraft }) {
  const coverage = resumeSourceCoverage(draft);
  return (
    <details className="career-profile-screen-coverage-details">
      <summary>Состав профиля</summary>
      <ul className="career-profile-screen-coverage">
        {[...coverage.filled, ...coverage.empty].map((section) => (
          <li key={section.id} className={section.count === 0 ? 'is-missing' : ''}>
            <span>{section.label}</span>
            <span>
              {section.id === 'courses' && section.count === 0
                ? 'Не найдены'
                : section.count === 0
                  ? 'Не заполнено'
                  : section.count === null
                    ? 'Есть'
                    : section.count}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ProfileCompletenessSummary({ draft }: { readonly draft: ResumeDraft }) {
  const completeness = profileCompleteness(draft);
  return (
    <div className="career-profile-screen-completion">
      <div>
        <span>Резюме собрано</span>{' '}
        <strong>
          <span className="career-profile-screen-numeric">{completeness.completedCount}</span> из{' '}
          <span className="career-profile-screen-numeric">{completeness.totalCount}</span> блоков
        </strong>
      </div>
      <progress
        className="career-profile-screen-completion-progress"
        value={completeness.completedCount}
        max={completeness.totalCount}
        aria-label={`Резюме собрано ${completeness.completedCount} из ${completeness.totalCount} блоков`}
      />
      {completeness.missingSections.length ? (
        <p>Не заполнено: {completeness.missingSections.join(', ').toLowerCase()}.</p>
      ) : null}
    </div>
  );
}

function TopcardProfileCopy({
  props,
  detailsOpen,
  onToggleDetails,
}: {
  readonly props: ProfileTopcardProps;
  readonly detailsOpen: boolean;
  readonly onToggleDetails: () => void;
}) {
  const { draft, updatedAt } = props;
  const fullName = draft.candidate.fullName?.trim();
  const headline = draft.candidate.headline?.trim() ?? draft.targetRole?.trim();
  const location = draft.candidate.contact?.location?.trim();
  const hasDetails = Boolean(location || updatedAt || draft.candidate.contact);
  return (
    <>
      <div className="career-profile-screen-id-main">
        <div className="career-profile-screen-name-row">
          <h1>{fullName || 'Имя не указано'}</h1>
        </div>
        {headline ? <p className="career-profile-screen-headline">{headline}</p> : null}
        <ProfileCompletenessSummary draft={draft} />
        {hasDetails ? (
          <ProfileDetailsToggle isOpen={detailsOpen} onToggle={onToggleDetails} />
        ) : null}
        <ProfileTopcardDetails
          isOpen={detailsOpen}
          location={location}
          updatedAt={updatedAt}
          draft={draft}
        />
      </div>
    </>
  );
}

export function ProfileTopcard(props: ProfileTopcardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <section className="career-profile-screen-topcard" aria-label="Основные данные профиля">
      <div className="career-profile-screen-id-row">
        <TopcardAvatar draft={props.draft} />
        <TopcardProfileCopy
          props={props}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((value) => !value)}
        />
        <TopcardEdit
          draft={props.draft}
          onDraftChange={props.onDraftChange}
          onSectionSave={props.onSectionSave}
          saving={props.saving}
        />
      </div>
      <ProfileStatusRow props={props} />
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
      <CaretDown size={14} aria-hidden="true" className="career-profile-screen-details-caret" />
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
      <ConnectionStatusChips
        connections={props.connections}
        importedSources={props.importedSources}
        importedSource={props.importedSource}
        onOpenConnections={props.onOpenConnections}
      />
      {props.reader ? (
        <span className="career-profile-screen-reader-status">{readerLabel(props.reader)}</span>
      ) : null}
      <ProfileCoverageDetails draft={props.draft} />
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
