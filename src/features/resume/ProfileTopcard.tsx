import { useState, type ReactNode } from 'react';
import { ProfileImportLive } from './ProfileImportLive';
import { useLinkedInImportProgress } from '../connections/linkedinImportProgress';
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
  Plus,
} from '@phosphor-icons/react';
import { useCandidateMediaSrc } from './candidateMediaSrc';
import { resumeSourceCoverage, type ImportedSource } from './resumeSourceCoverage';
import { profileCompleteness } from './profileCompleteness';
import { patchTopcard } from './profileEditing';
import type { ResumeDraft, ResumeReaderProvenance } from './resumeTypes';
import type {
  CandidateConnection,
  CandidateMemory,
  ImportedSourceSummary,
} from '../coach/coachApi';
import { PlatformLogo } from '../connections/PlatformLogo';
import { CONNECTION_PLATFORMS, PLATFORM_LABELS } from '../connections/platformLabels';
import { factCountLabel } from './profileSourceLabels';
import { ProfileSourceDialog } from './ProfileSourceDialog';
import { ProfileImportFailureNote } from './ProfileImportFailureNote';
import {
  formatPhoneInput,
  getContactEmailError,
  getContactPhoneError,
} from '../../../shared/contactValidation';

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
  readonly memory?: readonly CandidateMemory[];
  /** Opens «Аккаунт → Подключения» (C54 п.11) — no chip without it. */
  readonly onOpenConnections?: () => void;
  readonly onEdit?: () => void;
  readonly onOpenData?: () => void;
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
export function TopcardEditForm({
  draft,
  onSave,
  onCancel,
  saving,
  error,
}: {
  readonly draft: ResumeDraft;
  readonly onSave: (
    patch: Parameters<typeof patchTopcard>[1],
  ) => Promise<boolean | void> | boolean | void;
  readonly onCancel: () => void;
  readonly saving?: boolean;
  /** Save failure shown inside the form, in plain Russian (A8). */
  readonly error?: string;
}) {
  const [fullName, setFullName] = useState(draft.candidate.fullName ?? '');
  const [headline, setHeadline] = useState(draft.candidate.headline ?? '');
  const [location, setLocation] = useState(draft.candidate.contact?.location ?? '');
  const [email, setEmail] = useState(draft.candidate.contact?.email ?? '');
  const [phone, setPhone] = useState(draft.candidate.contact?.phone ?? '');
  const [touched, setTouched] = useState(false);
  const emailError = touched ? getContactEmailError(email) : null;
  const phoneError = touched ? getContactPhoneError(phone) : null;
  const submit = () => {
    setTouched(true);
    if (getContactEmailError(email) || getContactPhoneError(phone)) return;
    void onSave({ fullName, headline, location, email, phone });
  };
  return (
    <div className="career-profile-screen-edit-body">
      <div className="career-profile-screen-field-grid">
        <label className="career-profile-screen-field">
          <span>Имя</span>
          <input
            name="fullName"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </label>
        <label className="career-profile-screen-field">
          <span>Роль (headline)</span>
          <input
            name="headline"
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
          />
        </label>
        <label className="career-profile-screen-field">
          <span>Город</span>
          <input
            name="location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        <label className="career-profile-screen-field">
          <span>Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            aria-invalid={emailError ? true : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {emailError ? <small role="alert">{emailError}</small> : null}
        </label>
        <label className="career-profile-screen-field">
          <span>Телефон</span>
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            aria-invalid={phoneError ? true : undefined}
            onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
          />
          {phoneError ? <small role="alert">{phoneError}</small> : null}
        </label>
      </div>
      {error ? (
        <p className="career-resume-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="career-profile-screen-edit-actions">
        <button type="button" className="career-quiet-button" onClick={onCancel}>
          Отменить
        </button>
        <button type="button" className="career-primary-button" disabled={saving} onClick={submit}>
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
  const isConnected = isPlatformConnected(imported, connection);
  const detail = isConnected ? 'Подключено' : 'Не подключено';
  const contents = (
    <span
      className={`career-profile-screen-source-visual ${isConnected ? 'is-connected' : 'is-off'}`}
    >
      <span className="career-profile-screen-source-mark">
        <PlatformLogo platform={platform} size={16} />
        {isConnected ? null : <Plus size={10} weight="bold" aria-hidden="true" />}
      </span>
      <span className="career-profile-screen-source-name">{PLATFORM_LABELS[platform]}</span>
      <span className="career-profile-screen-source-detail">{detail}</span>
    </span>
  );

  return onOpenConnections ? (
    <SourceChipButton
      platform={platform}
      detail={detail}
      connection={connection}
      factCount={count}
      keptFactCount={imported && 'keptFactCount' in imported ? imported.keptFactCount : undefined}
      importedAt={importedAtValue(imported, connection)}
      onOpenConnections={onOpenConnections}
    >
      {contents}
    </SourceChipButton>
  ) : (
    <span className="career-profile-screen-source-chip">{contents}</span>
  );
}

/** C5: the chip says only «Подключено» — dates and counts live in the source window. */
function isPlatformConnected(
  imported: ImportedSourceSummary | ImportedSource | undefined,
  connection: CandidateConnection | undefined,
): boolean {
  return (
    Boolean(imported) || connection?.status === 'connected' || connection?.status === 'imported'
  );
}

function importedAtValue(
  imported: ImportedSourceSummary | ImportedSource | undefined,
  connection: CandidateConnection | undefined,
): string | undefined {
  if (imported && 'lastImportedAt' in imported) return imported.lastImportedAt;
  if (imported?.importedAt) return imported.importedAt;
  if (connection?.status === 'connected') return connection.lastImportedAt;
  return connection?.status === 'imported' ? connection.importedAt : undefined;
}

/** Макет 2: чип источника открывает окно источника, а не сразу «Аккаунт». */
function SourceChipButton(props: {
  readonly platform: (typeof CONNECTION_PLATFORMS)[number];
  readonly detail: string;
  readonly connection?: CandidateConnection;
  readonly factCount?: number;
  readonly keptFactCount?: number;
  readonly importedAt?: string;
  readonly onOpenConnections: () => void;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="career-profile-screen-source-chip career-profile-screen-connection-chip"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${PLATFORM_LABELS[props.platform]} · ${props.detail} · Управлять подключением`}
      >
        {props.children}
      </button>
      <ProfileSourceDialog
        platform={props.platform}
        connection={props.connection}
        factCount={props.factCount}
        keptFactCount={props.keptFactCount}
        importedAt={props.importedAt}
        isOpen={open}
        onClose={() => setOpen(false)}
        onOpenConnections={() => {
          setOpen(false);
          props.onOpenConnections();
        }}
      />
    </>
  );
}

function ProfileSourceActions({
  allConnected,
  hasImports,
  hasWalk,
  onOpenConnections,
}: {
  /** C12: «+ Источник» has nothing to add once every platform is connected. */
  readonly allConnected: boolean;
  readonly hasImports: boolean;
  /** The walk band carries its own «Импортировать заново» (макет 2). */
  readonly hasWalk: boolean;
  readonly onOpenConnections?: () => void;
}) {
  const importRunning = Boolean(useLinkedInImportProgress()) || hasWalk;
  if (!onOpenConnections) return null;
  return (
    <>
      {allConnected ? null : (
        <button
          className="career-profile-screen-source-add"
          type="button"
          onClick={onOpenConnections}
        >
          <Plus size={16} aria-hidden="true" />
          Источник
        </button>
      )}
      {hasImports && !importRunning ? (
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
      <ProfileSourceActions
        allConnected={CONNECTION_PLATFORMS.every((platform) =>
          isPlatformConnected(
            sources.find((entry) => entry.platform === platform),
            connections?.find((entry) => entry.platform === platform),
          ),
        )}
        hasImports={hasImports}
        hasWalk={sources.some((source) => 'walk' in source && Boolean(source.walk))}
        onOpenConnections={onOpenConnections}
      />
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

function CompletenessCount({
  value,
  onOpenData,
}: {
  readonly value: ReturnType<typeof profileCompleteness>;
  readonly onOpenData?: () => void;
}) {
  const count = (
    <>
      <span className="career-profile-screen-numeric">{value.completedCount}</span> из{' '}
      <span className="career-profile-screen-numeric">{value.totalCount}</span> блоков
    </>
  );
  return (
    <strong>
      {onOpenData ? (
        <button
          type="button"
          className="profile-completeness-control"
          aria-label="Открыть данные профиля"
          onClick={onOpenData}
        >
          {count}
        </button>
      ) : (
        count
      )}
    </strong>
  );
}

function ProfileCompletenessSummary({
  draft,
  memory,
  onOpenData,
}: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly onOpenData?: () => void;
}) {
  const completeness = profileCompleteness(draft);
  const proposedFactCount = memory.filter(
    (item) => item.kind === 'fact' && item.status === 'proposed',
  ).length;
  return (
    <div className="career-profile-screen-completion">
      <div>
        <span>Резюме собрано</span>{' '}
        <CompletenessCount value={completeness} onOpenData={onOpenData} />
      </div>
      <progress
        className="career-profile-screen-completion-progress"
        value={Math.round((completeness.completedCount / completeness.totalCount) * 100)}
        max={100}
        aria-label={`Резюме собрано ${completeness.completedCount} из ${completeness.totalCount} блоков`}
      />
      {proposedFactCount > 0 ? (
        <p className="career-profile-screen-proposed-facts">
          {factCountLabel(proposedFactCount)} {proposedFactCount === 1 ? 'ждёт' : 'ждут'}{' '}
          подтверждения
        </p>
      ) : null}
      {completeness.missingSections.length ? (
        <p>Не заполнено: {completeness.missingSections.join(', ').toLowerCase()}.</p>
      ) : null}
    </div>
  );
}

function TopcardName({ name, onEdit }: { readonly name?: string; readonly onEdit?: () => void }) {
  return (
    <div className="career-profile-screen-name-row">
      <h1 aria-label={name || 'Имя не указано'}>
        {onEdit ? (
          <button
            type="button"
            className="profile-name-control"
            aria-label="Изменить основные данные профиля"
            onClick={onEdit}
          >
            {name || 'Имя не указано'}
          </button>
        ) : (
          name || 'Имя не указано'
        )}
      </h1>
    </div>
  );
}

function TopcardProfileMeta({ draft }: { readonly draft: ResumeDraft }) {
  // Макет 2: «должность, компания · город» текущего места; заголовок резюме — если места нет.
  const headline =
    draft.experience.find((entry) => entry.current)?.title?.trim() ||
    draft.candidate.headline?.trim() ||
    draft.targetRole?.trim();
  const contains = (text: string | undefined, part: string | undefined) =>
    Boolean(
      text && part && text.toLocaleLowerCase('ru-RU').includes(part.toLocaleLowerCase('ru-RU')),
    );
  // An imported headline often already carries the company and city; never say them twice.
  const currentEmployer = draft.experience.find((entry) => entry.current)?.employer?.trim();
  const employer = contains(headline, currentEmployer) ? undefined : currentEmployer;
  const rawLocation = draft.candidate.contact?.location?.trim();
  const location = contains(headline, rawLocation) ? undefined : rawLocation;
  return (
    <div className="career-profile-screen-profile-meta">
      {headline || employer ? (
        <p className="career-profile-screen-headline">
          {[headline, employer].filter(Boolean).join(', ')}
        </p>
      ) : null}
      {location ? (
        <>
          {headline || employer ? (
            <span className="career-profile-screen-meta-separator" aria-hidden="true">
              ·
            </span>
          ) : null}
          <span className="career-profile-screen-inline-location">
            <MapPin size={14} aria-hidden="true" />
            {location}
          </span>
        </>
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
  const location = draft.candidate.contact?.location?.trim();
  const hasDetails = Boolean(location || updatedAt || draft.candidate.contact);
  return (
    <>
      <div className="career-profile-screen-id-main">
        <TopcardName name={draft.candidate.fullName?.trim()} onEdit={props.onEdit} />
        <TopcardProfileMeta draft={draft} />
        <ProfileCompletenessSummary
          draft={draft}
          memory={props.memory ?? []}
          onOpenData={props.onOpenData}
        />
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
    <section
      id="career-profile-screen-topcard"
      className="career-profile-screen-topcard"
      aria-label="Основные данные профиля"
    >
      <div className="career-profile-screen-id-row">
        <TopcardAvatar draft={props.draft} />
        <TopcardProfileCopy
          props={props}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((value) => !value)}
        />
        {!props.onEdit ? (
          <TopcardEdit
            draft={props.draft}
            onDraftChange={props.onDraftChange}
            onSectionSave={props.onSectionSave}
            saving={props.saving}
          />
        ) : null}
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
          <span className="career-profile-screen-detail-location">
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
      <ProfileImportLive
        onReimport={props.onOpenConnections}
        storedWalk={props.importedSources?.find((source) => source.walk)?.walk}
      />
      <ProfileImportFailureNote
        variant="desktop"
        onReimport={props.onOpenConnections}
        storedWalk={props.importedSources?.find((source) => source.walk)?.walk}
      />
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
