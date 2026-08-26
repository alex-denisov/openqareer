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
  readonly onHhConnected: (
    resumes: HhResumeItem[],
    parsed?: ParsedResume,
    url?: string,
  ) => void | Promise<void>;
  readonly onHhAuthenticatedEmpty: () => void;
  readonly hhResumes: readonly HhResumeItem[];
  readonly selectedHhResumeId: string;
  readonly onSelectHhResume: (id: string) => void;
  readonly onImportHhResume: () => void;
  readonly hhConnected: boolean;
  readonly linkedinConnected: boolean;
  /** A platform this account already imported from, as the server holds it. */
  readonly connectedSource?: ConnectedProfileSource;
}

export function IntakeSourceStep(props: IntakeSourceStepProps) {
  const { sourceChoice, lock } = props;
  const closed = (choice: SourceChoice) =>
    lock.lockedTo !== undefined && lock.lockedTo !== choice;
  return (
    <div className="career-source-step">
      <div className="career-source-choice" role="group" aria-label="Источник опыта">
        {(
          [
            ['profile-import', 'Импорт профиля', PlugsConnected],
            ['pdf', 'PDF', FilePdf],
            ['text', 'Текстом', Sparkle],
            ['none', 'Без документов', ArrowRight],
          ] as Array<[SourceChoice, string, Icon]>
        ).map(([choice, label, icon]) => (
          <SourceButton
            key={choice}
            icon={icon}
            label={label}
            selected={sourceChoice === choice}
            disabled={closed(choice)}
            closedReason={closed(choice) ? lock.reason : undefined}
            onClick={() => props.onChooseSource(choice)}
          />
        ))}
      </div>

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

      <SourceLockNotice reason={lock.reason} onRelease={props.onReleaseSource} />
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
              : 'PDF до 20 МБ · файл читается в браузере; в профиль отправляется извлечённый текст, исходный файл не сохраняется'}
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
  // A list is only worth showing while something is still unimported.
  const showResumePicker = props.hhConnected && props.hhResumes.length > 0 && !hhReady;
  return (
    <div className="career-source-fields">
      <div className="career-platform-cards">
        <PlatformCard
          platform="linkedin"
          name="LinkedIn"
          description="Импорт опыта и навыков из вашего профиля LinkedIn."
          connected={linkedinReady}
          disabled={
            props.busy ||
            (props.lock.lockedTo !== undefined && props.lock.lockedTo !== 'profile-import')
          }
          onConnect={() => props.onLinkedinOpen(true)}
          onDisconnect={() => props.onDisconnectPlatform('linkedin')}
        />
        <PlatformCard
          platform="hh"
          name="hh.ru"
          description="Импорт вашего резюме с hh.ru: вход проходит на странице hh.ru, в вашей сессии."
          connected={hhReady}
          disabled={
            props.busy ||
            (props.lock.lockedTo !== undefined && props.lock.lockedTo !== 'profile-import')
          }
          onConnect={() => props.onHhOpen(true)}
          onDisconnect={() => props.onDisconnectPlatform('hh')}
        />
      </div>

      {/* One slot under the two cards. While a signed-in hh.ru account still
          owes the wizard a choice it holds the picker; the moment the chosen
          resume is in the profile the release control takes the same place,
          instead of stacking a green banner on top of a picker that has
          nothing left to pick (owner report, 2026-08-26). */}
      {showResumePicker ? (
        <div className="career-hh-resumes-selector">
          <label htmlFor="hh-resume-dropdown">Выберите резюме для импорта</label>
          <div className="career-hh-resumes-row">
            <select
              id="hh-resume-dropdown"
              className="career-hh-resumes-select"
              value={props.selectedHhResumeId}
              onChange={(event) => props.onSelectHhResume(event.target.value)}
              disabled={props.busy}
            >
              {props.hhResumes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="career-primary-button"
              onClick={props.onImportHhResume}
              disabled={props.busy}
            >
              {props.busy ? 'Импортируем…' : 'Импортировать выбранное резюме'}
            </button>
          </div>
        </div>
      ) : props.hhConnected && !hhReady && props.hhResumes.length === 0 ? (
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
        onConnectionFailure={props.onProviderConnectionFailure}
      />
    </div>
  );
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
function PlatformCard({
  platform,
  name,
  description,
  connected,
  disabled,
  onConnect,
  onDisconnect,
}: {
  platform: 'linkedin' | 'hh';
  name: string;
  description: string;
  connected: boolean;
  disabled: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className={`career-platform-card ${connected ? 'is-connected' : ''}`}>
      <div className="career-platform-card-header">
        <div className="career-platform-card-title">
          <PlatformLogo platform={platform} size={26} />
          <span>{name}</span>
        </div>
        <span
          className={`career-platform-card-badge ${connected ? 'is-connected' : ''}`}
        >
          {connected ? 'Подключено' : 'Не подключено'}
        </span>
      </div>
      <p className="career-platform-card-desc">{description}</p>
      <button
        type="button"
        className={`career-platform-card-action ${
          connected ? 'career-quiet-button' : 'career-primary-button'
        }`}
        disabled={disabled}
        onClick={connected ? onDisconnect : onConnect}
      >
        {connected ? 'Отключить' : 'Подключить'}
      </button>
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
    plural(parsed.experience.length, ['место работы', 'места работы', 'мест работы']),
    plural(parsed.skills.length, ['навык', 'навыка', 'навыков']),
    plural(parsed.education.length, ['запись об учёбе', 'записи об учёбе', 'записей об учёбе']),
    plural(parsed.courses.length, ['курс', 'курса', 'курсов']),
    plural(parsed.languages.length, ['язык', 'языка', 'языков']),
  ].filter((part) => part !== null);
  return parts.length > 0
    ? `найдено: ${parts.join(', ')}`
    : 'структурированных разделов не нашлось — можно дополнить профиль вручную';
}

function plural(count: number, forms: [string, string, string]): string | null {
  if (count === 0) return null;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${forms[0]}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ${forms[1]}`;
  }
  return `${count} ${forms[2]}`;
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
      disabled={disabled}
      aria-label={closedReason ? `${label}. ${closedReason}` : undefined}
      title={closedReason ?? label}
      onClick={onClick}
    >
      <ItemIcon size={20} weight={selected ? 'fill' : 'regular'} />
      <span>{label}</span>
    </button>
  );
}
