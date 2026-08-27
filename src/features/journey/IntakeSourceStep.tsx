import type { ChangeEvent } from 'react';
import {
  ArrowRight,
  CheckCircle,
  FilePdf,
  PlugsConnected,
  Sparkle,
  type Icon,
} from '@phosphor-icons/react';
import {
  HhConnectModal,
  LinkedInConnectModal,
  WebDesktopCtaCallout,
  type HhResumeItem,
} from '../connections/ProfileImportModals';
import { PlatformLogo } from '../connections/PlatformLogo';
import type { ParsedResume } from '../workspace/resumeParser';
import type { IngestedResume } from './useResumeIngestion';
import type { IntakeSourceLockState } from './intakeSourceLock';
import type { ConnectedProfileSource } from './connectedProfileSource';
import { pluralRu } from '../../../shared/pluralRu';
import { LOCAL_PDF_MAX_BYTES, megabytes } from '../../../shared/fileLimits';

export type SourceChoice = 'profile-import' | 'pdf' | 'text' | 'none';

export interface IntakeSourceStepProps {
  readonly isDesktop: boolean;
  readonly sourceChoice: SourceChoice;
  readonly onChooseSource: (choice: SourceChoice) => void;
  /** Which source the picture is being built from, and why the rest are shut. */
  readonly lock: IntakeSourceLockState;
  /** Releases that source so another one can be chosen. */
  readonly onReleaseSource: () => void;
  /**
   * Signs this account out of the platform: the stored connection goes, and so
   * does the sign-in the desktop shell is holding for it.
   */
  readonly onDisconnectPlatform: (platform: 'hh' | 'linkedin') => void;
  readonly ingested?: IngestedResume;
  readonly busy: boolean;
  readonly notice?: string;
  readonly resumeText: string;
  readonly onResumeText: (value: string) => void;
  readonly onPickPdf: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly linkedinOpen: boolean;
  readonly hhOpen: boolean;
  readonly onLinkedinOpen: (open: boolean) => void;
  readonly onHhOpen: (open: boolean) => void;
  readonly onLinkedinImported: (
    parsed: ParsedResume,
    url: string,
  ) => void | Promise<void>;
  readonly onProviderConnectionFailure: (message: string) => void;
  /** One resume, already read inside the candidate's own hh.ru session. */
  readonly onHhConnected: (
    resumes: readonly HhResumeItem[],
    parsed: ParsedResume,
    url: string,
  ) => void | Promise<void>;
  readonly onHhAuthenticatedEmpty: () => void;
  readonly hhConnected: boolean;
  /** hh.ru itself reported an account with no resume. Nothing else may claim it. */
  readonly hhEmptyAccount?: boolean;
  readonly linkedinConnected: boolean;
  /** A platform this account already imported from, as the server holds it. */
  readonly connectedSource?: ConnectedProfileSource;
}

const SOURCE_CHOICES: ReadonlyArray<[SourceChoice, string, Icon]> = [
  ['profile-import', 'Импорт профиля', PlugsConnected],
  ['pdf', 'PDF', FilePdf],
  ['text', 'Текстом', Sparkle],
  ['none', 'Без документов', ArrowRight],
];

function SourceChoiceRow({
  sourceChoice,
  lock,
  onChooseSource,
}: Pick<IntakeSourceStepProps, 'sourceChoice' | 'lock' | 'onChooseSource'>) {
  const closed = (choice: SourceChoice) =>
    lock.lockedTo !== undefined && lock.lockedTo !== choice;
  return (
    <div className="career-source-choice" role="group" aria-label="Источник опыта">
      {SOURCE_CHOICES.map(([choice, label, icon]) => (
        <SourceButton
          key={choice}
          icon={icon}
          label={label}
          selected={sourceChoice === choice}
          disabled={closed(choice)}
          closedReason={closed(choice) ? lock.reason : undefined}
          onClick={() => onChooseSource(choice)}
        />
      ))}
    </div>
  );
}

export function IntakeSourceStep(props: IntakeSourceStepProps) {
  const { sourceChoice, lock } = props;
  return (
    <div className="career-source-step">
      <SourceChoiceRow
        sourceChoice={sourceChoice}
        lock={lock}
        onChooseSource={props.onChooseSource}
      />

      {sourceChoice === 'pdf' ? <PdfSource {...props} /> : null}
      {sourceChoice === 'profile-import' ? <ProfileImportSource {...props} /> : null}

      {sourceChoice === 'text' ? (
        <label className="career-source-textarea">
          <span>Опыт, проекты или фрагмент резюме</span>
          <textarea
            value={props.resumeText}
            onChange={(event) => props.onResumeText(event.target.value)}
            placeholder="Например: чем вы управляли, что изменили, с кем работали и за какой результат отвечали."
            rows={8}
          />
        </label>
      ) : null}

      {sourceChoice === 'none' ? (
        <p className="career-inline-note">
          Это нормальный старт. Сначала зададим один вопрос об опыте и не будем
          оценивать резюме, которого нет.
        </p>
      ) : null}

      {/* A connected platform card already carries «Отключить», so the plate
          would be a second door to the same room (owner report, 2026-08-26).
          PDF and typed text have no such card — there the plate stays. */}
      {lock.lockedTo === 'profile-import' ? null : (
        <SourceLockNotice reason={lock.reason} onRelease={props.onReleaseSource} />
      )}
    </div>
  );
}

/**
 * Says which source the career picture is being built from, and offers the one
 * way back out of it.
 *
 * It sits **after** the source it describes, not between the source buttons and
 * the source itself: wedged in above, the sentence ran into the buttons it was
 * explaining, and the owner read the two as one broken control
 * (owner report, 2026-08-26). In the profile-import step this lands directly
 * under the LinkedIn and hh.ru cards, and it takes the place the resume picker
 * occupied once that picker has done its job.
 */
function SourceLockNotice({
  reason,
  onRelease,
}: {
  reason?: string;
  onRelease: () => void;
}) {
  if (!reason) return null;
  return (
    <div className="career-source-lock" role="status">
      <span>{reason}</span>
      <button type="button" className="career-quiet-button" onClick={onRelease}>
        Сменить источник
      </button>
    </div>
  );
}

function PdfSource({ ingested, busy, lock, onPickPdf, notice }: IntakeSourceStepProps) {
  // Once a file has been read, picking another one is a source change, not a
  // second document: the release control above is the way back.
  const locked = lock.lockedTo === 'pdf';
  return (
    <div className="career-pdf-source">
      <div className="career-pdf-source-row">
        <label className="career-primary-button career-file-button" data-locked={locked}>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={onPickPdf}
            disabled={locked || busy}
          />
          <FilePdf size={20} />
          <span>
            {busy ? 'Разбираем резюме…' : (ingested?.file?.name ?? 'Выбрать PDF')}
          </span>
        </label>
        <small>
          {busy
            ? 'Разбор занимает до минуты: читаем структуру, а не ключевые слова.'
            : ingested?.file
              ? `${ingested.file.pages} стр.`
              : `PDF до ${megabytes(LOCAL_PDF_MAX_BYTES)} МБ · файл читается в браузере; в профиль отправляется извлечённый текст, исходный файл не сохраняется`}
        </small>
      </div>
      {ingested ? <ImportSummary ingested={ingested} notice={notice} /> : null}
    </div>
  );
}

// One component, one JSX tree: splitting further would scatter the markup.
// eslint-disable-next-line max-lines-per-function
function ProfileImportSource(props: IntakeSourceStepProps) {
  if (!props.isDesktop) {
    return (
      <div className="career-source-fields">
        <WebDesktopCtaCallout />
      </div>
    );
  }
  const restored = props.connectedSource;
  const linkedinReady = Boolean(
    restored?.platform === 'linkedin' ||
      (props.linkedinConnected &&
        props.ingested?.source === 'linkedin-pdf' &&
        props.ingested.imported &&
        props.ingested.connection),
  );
  // Finding a signed-in account/list is not the same outcome as importing one
  // selected resume into the candidate profile.
  const hhReady = Boolean(
    restored?.platform === 'hh' ||
      (props.ingested?.source === 'hh-pdf' &&
        props.ingested.imported &&
        props.ingested.connection),
  );
  const otherSourceHolds =
    props.lock.lockedTo !== undefined && props.lock.lockedTo !== 'profile-import';
  return (
    <div className="career-source-fields">
      <div className="career-platform-cards">
        <PlatformCard
          platform="linkedin"
          name="LinkedIn"
          description="Импорт опыта и навыков из вашего профиля LinkedIn."
          connected={linkedinReady}
          disabled={props.busy || otherSourceHolds}
          blockedReason={hhReady ? occupiedBy('hh.ru', 'LinkedIn') : undefined}
          onConnect={() => props.onLinkedinOpen(true)}
          onDisconnect={() => props.onDisconnectPlatform('linkedin')}
        />
        <PlatformCard
          platform="hh"
          name="hh.ru"
          description="Импорт вашего резюме с hh.ru: вход проходит на странице hh.ru, в вашей сессии."
          connected={hhReady}
          disabled={props.busy || otherSourceHolds}
          blockedReason={linkedinReady ? occupiedBy('LinkedIn', 'hh.ru') : undefined}
          onConnect={() => props.onHhOpen(true)}
          onDisconnect={() => props.onDisconnectPlatform('hh')}
        />
      </div>

      {/* The resume picker lives inside the hh.ru dialog, next to the session
          window that answers it. Standing here it outlived both, and the import
          it triggered read through a window that was already gone
          (owner report, 2026-08-26). */}
      {props.hhEmptyAccount && !hhReady ? (
        <p className="career-inline-note">
          В профиле hh.ru не нашлось резюме. Можно загрузить PDF или описать опыт
          текстом.
        </p>
      ) : null}

      <LinkedInConnectModal
        isOpen={props.linkedinOpen}
        onClose={() => props.onLinkedinOpen(false)}
        onImportSuccess={props.onLinkedinImported}
        onConnectionFailure={props.onProviderConnectionFailure}
      />
      <HhConnectModal
        isOpen={props.hhOpen}
        onClose={() => props.onHhOpen(false)}
        onConnectSuccess={props.onHhConnected}
        onAuthenticatedEmpty={props.onHhAuthenticatedEmpty}
      />
    </div>
  );
}

/**
 * Why the second platform is shut, naming both sides. One connected profile is
 * the account's source of truth; a second one would be a different account of
 * the same career with nothing downstream to merge them.
 */
function occupiedBy(connected: string, blocked: string): string {
  return `Профиль ${connected} уже подключён. Чтобы подключить ${blocked}, сначала отключите ${connected}.`;
}

/**
 * A platform, its real state, and the one action that state allows.
 *
 * A connected card offers «Отключить» in the place «Подключить» occupied. The
 * card used to offer «Обновить импорт» there, and signing out was buried in the
 * session dialog's toolbar as «Выйти из hh.ru» — the owner asked for the sign
 * out to live here, on the card, where the connection itself is shown
 * (owner report, 2026-08-26). Re-importing is disconnect, then connect.
 */
/** The one action a platform's real state allows, and why it may be shut. */
function PlatformCardAction({
  name,
  connected,
  disabled,
  blocked,
  blockedReason,
  onConnect,
  onDisconnect,
}: {
  name: string;
  connected: boolean;
  disabled: boolean;
  blocked: boolean;
  blockedReason?: string;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <button
      type="button"
      className={`career-platform-card-action ${
        connected ? 'career-quiet-button' : 'career-primary-button'
      }`}
      disabled={disabled}
      aria-disabled={blocked ? true : undefined}
      title={blockedReason}
      aria-label={blocked ? `Подключить ${name}. ${blockedReason}` : undefined}
      onClick={blocked ? undefined : connected ? onDisconnect : onConnect}
    >
      {connected ? 'Отключить' : 'Подключить'}
    </button>
  );
}

interface PlatformCardProps {
  readonly platform: 'linkedin' | 'hh';
  readonly name: string;
  readonly description: string;
  readonly connected: boolean;
  readonly disabled: boolean;
  /** Set when the other platform holds the account, and says which one. */
  readonly blockedReason?: string;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
}

function PlatformCardHeader({
  platform,
  name,
  connected,
}: Pick<PlatformCardProps, 'platform' | 'name' | 'connected'>) {
  return (
    <div className="career-platform-card-header">
      <div className="career-platform-card-title">
        <PlatformLogo platform={platform} size={26} />
        <span>{name}</span>
      </div>
      <span className={`career-platform-card-badge ${connected ? 'is-connected' : ''}`}>
        {connected ? 'Подключено' : 'Не подключено'}
      </span>
    </div>
  );
}

function PlatformCard({
  platform,
  name,
  description,
  connected,
  disabled,
  blockedReason,
  onConnect,
  onDisconnect,
}: PlatformCardProps) {
  const blocked = !connected && blockedReason !== undefined;
  return (
    <div
      className={`career-platform-card ${connected ? 'is-connected' : ''}`}
      data-blocked={blocked ? 'true' : undefined}
    >
      <PlatformCardHeader platform={platform} name={name} connected={connected} />
      <p className="career-platform-card-desc">{description}</p>
      {/* A natively disabled button never fires the hover that would show its
          reason, so a blocked card stays reachable and inert instead
          (owner report, 2026-08-26). `busy` is still a real `disabled`. */}
      <PlatformCardAction
        name={name}
        connected={connected}
        disabled={disabled}
        blocked={blocked}
        blockedReason={blockedReason}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />
    </div>
  );
}

/**
 * States what the import actually produced. When the server stored the facts it
 * says so; when it did not, it says that instead of showing a green tick over
 * nothing.
 */
function ImportSummary({
  ingested,
  notice,
}: {
  ingested: IngestedResume;
  notice?: string;
}) {
  const { parsed } = ingested;
  return (
    <div
      className={`career-import-summary ${ingested.imported ? 'is-stored' : 'is-local'}`}
      role="status"
    >
      <CheckCircle size={26} weight="fill" />
      <div>
        <strong>
          {ingested.imported
            ? 'Резюме разобрано и сохранено в профиль'
            : 'Резюме разобрано'}
        </strong>
        <span>
          {ingested.file ? `«${ingested.file.name}» · ` : ''}
          {countLine(parsed)}
        </span>
        {notice ? <em>{notice}</em> : null}
      </div>
    </div>
  );
}

function countLine(parsed: ParsedResume): string {
  const parts = [
    parsed.experience.length === 0
      ? null
      : pluralRu(parsed.experience.length, ['место работы', 'места работы', 'мест работы']),
    parsed.skills.length === 0
      ? null
      : pluralRu(parsed.skills.length, ['навык', 'навыка', 'навыков']),
    parsed.education.length === 0
      ? null
      : pluralRu(parsed.education.length, ['запись об учёбе', 'записи об учёбе', 'записей об учёбе']),
    parsed.courses.length === 0
      ? null
      : pluralRu(parsed.courses.length, ['курс', 'курса', 'курсов']),
    parsed.languages.length === 0
      ? null
      : pluralRu(parsed.languages.length, ['язык', 'языка', 'языков']),
  ].filter((part): part is string => part !== null);
  return parts.length > 0
    ? `найдено: ${parts.join(', ')}`
    : 'структурированных разделов не нашлось — можно дополнить профиль вручную';
}

function SourceButton({
  icon: ItemIcon,
  label,
  selected,
  disabled,
  closedReason,
  onClick,
}: {
  icon: Icon;
  label: string;
  selected: boolean;
  disabled?: boolean;
  closedReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={selected ? 'is-selected' : ''}
      aria-pressed={selected}
      aria-disabled={disabled ? true : undefined}
      data-blocked={disabled ? 'true' : undefined}
      aria-label={closedReason ? `${label}. ${closedReason}` : undefined}
      title={closedReason ?? label}
      onClick={disabled ? undefined : onClick}
    >
      <ItemIcon size={20} weight={selected ? 'fill' : 'regular'} />
      <span>{label}</span>
    </button>
  );
}
