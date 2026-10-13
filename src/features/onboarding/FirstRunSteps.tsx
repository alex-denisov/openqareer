import type { ReactElement, ReactNode } from 'react';
import {
  Briefcase,
  ChatCircleText,
  Check,
  LinkedinLogo,
  PencilSimple,
  UploadSimple,
} from '@phosphor-icons/react';
import type { FirstRunData, SourceType, WorkFormat } from './firstRunTypes';

function GoalEditForm({
  goal,
  onGoalChange,
  onSave,
}: {
  readonly goal: string;
  readonly onGoalChange: (val: string) => void;
  readonly onSave: () => void;
}): ReactElement {
  return (
    <div className="first-run-field">
      <textarea
        className="first-run-textarea"
        rows={2}
        value={goal}
        onChange={(e) => onGoalChange(e.target.value)}
        data-testid="goal-textarea"
      />
      <button
        type="button"
        className="first-run-btn-ghost first-run-btn-save-goal"
        onClick={onSave}
        data-testid="save-goal-btn"
      >
        Сохранить
      </button>
    </div>
  );
}

export function FirstRunGoalCard({
  goal,
  onGoalChange,
  isEditing,
  onStartEdit,
  onSaveEdit,
}: {
  readonly goal: string;
  readonly onGoalChange: (val: string) => void;
  readonly isEditing: boolean;
  readonly onStartEdit: () => void;
  readonly onSaveEdit: () => void;
}): ReactElement {
  return (
    <article className="first-run-stage-card is-done" aria-labelledby="goal-title">
      <div className="first-run-stage-head">
        <div className="first-run-stage-title-wrap">
          <span className="first-run-stage-badge is-done">
            <Check size={16} />
          </span>
          <h2 id="goal-title" className="first-run-stage-title">
            Цель
          </h2>
        </div>
        {!isEditing ? (
          <button
            type="button"
            className="first-run-btn-ghost"
            onClick={onStartEdit}
            data-testid="edit-goal-btn"
          >
            <PencilSimple size={14} className="first-run-edit-icon" />
            Изменить
          </button>
        ) : null}
      </div>
      {isEditing ? (
        <GoalEditForm goal={goal} onGoalChange={onGoalChange} onSave={onSaveEdit} />
      ) : (
        <p className="first-run-goal-text">{goal}</p>
      )}
    </article>
  );
}

export function SourceOptionRow({
  type,
  title,
  desc,
  btnText,
  isPicked,
  onPick,
}: {
  readonly type: SourceType;
  readonly title: string;
  readonly desc: string;
  readonly btnText: string;
  readonly isPicked: boolean;
  readonly onPick: () => void;
}): ReactElement {
  const icons: Record<SourceType, ReactElement> = {
    linkedin: <LinkedinLogo size={24} />,
    hh: <Briefcase size={24} />,
    file: <UploadSimple size={24} />,
    talk: <ChatCircleText size={24} />,
  };

  return (
    <button
      type="button"
      className={`first-run-source-opt ${isPicked ? 'is-picked' : ''}`}
      aria-pressed={isPicked}
      onClick={onPick}
      data-testid={`source-opt-${type}`}
    >
      <span className="first-run-source-ico">{icons[type]}</span>
      <div className="first-run-source-info">
        <b>{title}</b>
        <p>{desc}</p>
      </div>
      <span
        className={`first-run-source-action-label${isPicked ? ' is-selected' : ''}`}
      >
        {btnText}
      </span>
      <span className="first-run-source-check">
        {isPicked ? <Check size={18} /> : null}
      </span>
    </button>
  );
}

const SOURCE_ITEMS = [
  {
    type: 'linkedin' as const,
    title: 'LinkedIn',
    desc: 'Разделы профиля станут доступны после подключения аккаунта',
    btnText: 'Подключить',
  },
  {
    type: 'hh' as const,
    title: 'hh.ru',
    desc: 'Резюме станет доступно после подключения аккаунта',
    btnText: 'Подключить',
  },
  {
    type: 'file' as const,
    title: 'Файл резюме',
    desc: 'PDF, до 20 МБ',
    btnText: 'Загрузить',
  },
  {
    type: 'talk' as const,
    title: 'Рассказать консультанту',
    desc: 'Можно обсудить цель и следующие шаги без подключения источника',
    btnText: 'Начать',
  },
] as const;

function SourceGridList({
  data,
  onSelectSource,
  onConnectSource,
  onTriggerFileUpload,
  onTriggerConsultant,
}: {
  readonly data: FirstRunData;
  readonly onSelectSource: (s: SourceType) => void;
  readonly onConnectSource?: (source: 'linkedin' | 'hh') => void;
  readonly onTriggerFileUpload: () => void;
  readonly onTriggerConsultant: () => void;
}): ReactElement {
  return (
    <div className="first-run-source-grid">
      {SOURCE_ITEMS.map((item) => (
        <SourceOptionRow
          key={item.type}
          type={item.type}
          title={item.title}
          desc={item.desc}
          btnText={item.btnText}
          isPicked={data.selectedSource === item.type}
          onPick={() => {
            onSelectSource(item.type);
            if (item.type === 'linkedin' || item.type === 'hh') {
              onConnectSource?.(item.type);
            }
            if (item.type === 'file') onTriggerFileUpload();
            if (item.type === 'talk') onTriggerConsultant();
          }}
        />
      ))}
    </div>
  );
}

function SourceCardActions({
  source,
  onNext,
  onSkip,
}: {
  readonly source: SourceType | null;
  readonly onNext: () => void;
  readonly onSkip: () => void;
}): ReactElement {
  return (
    <div className="first-run-actions">
      <button
        type="button"
        className="first-run-btn-ghost"
        onClick={onNext}
        data-testid="source-next-btn"
      >
        {source === 'linkedin' || source === 'hh' ? 'Продолжить без подключения' : 'Продолжить'}
      </button>
      <button
        type="button"
        className="first-run-btn-ghost"
        onClick={onSkip}
        data-testid="source-skip-btn"
      >
        Пропустить этот шаг
      </button>
    </div>
  );
}

interface FirstRunUploadStatusProps {
  readonly uploadedFileName?: string;
  readonly isIngesting?: boolean;
  readonly ingestionError?: string | null;
  readonly ingestionNotice?: string | null;
}

function FirstRunUploadStatus({
  uploadedFileName,
  isIngesting,
  ingestionError,
  ingestionNotice,
}: FirstRunUploadStatusProps): ReactElement | null {
  if (!uploadedFileName && !isIngesting && !ingestionError && !ingestionNotice) return null;
  return (
    <>
      {uploadedFileName ? (
        <div className="first-run-uploaded-file-badge" data-testid="uploaded-file-info">
          <span>Файл резюме: <b>{uploadedFileName}</b></span>
        </div>
      ) : null}
      {isIngesting ? (
        <p className="first-run-upload-status is-loading" role="status">
          Обрабатываем файл резюме...
        </p>
      ) : null}
      {ingestionError ? (
        <p className="first-run-upload-status is-error" role="alert">
          {ingestionError}
        </p>
      ) : null}
      {ingestionNotice ? (
        <p className="first-run-upload-status" role="status">
          {ingestionNotice}
        </p>
      ) : null}
    </>
  );
}

function SourceCardHeader(): ReactElement {
  return (
    <div className="first-run-stage-head">
      <div className="first-run-stage-title-wrap">
        <span className="first-run-stage-badge">2</span>
        <h2 id="source-title" className="first-run-stage-title">
          Источник
        </h2>
      </div>
    </div>
  );
}

export function FirstRunSourceCard({
  data,
  uploadedFileName,
  isIngesting,
  ingestionError,
  ingestionNotice,
  onSelectSource,
  onConnectSource,
  onTriggerFileUpload,
  onTriggerConsultant,
  onNext,
  onSkip,
}: {
  readonly data: FirstRunData;
  readonly uploadedFileName?: string;
  readonly isIngesting?: boolean;
  readonly ingestionError?: string | null;
  readonly ingestionNotice?: string | null;
  readonly onSelectSource: (s: SourceType) => void;
  readonly onConnectSource?: (source: 'linkedin' | 'hh') => void;
  readonly onTriggerFileUpload: () => void;
  readonly onTriggerConsultant: () => void;
  readonly onNext: () => void;
  readonly onSkip: () => void;
}): ReactElement {
  return (
    <article className="first-run-stage-card is-active" aria-labelledby="source-title">
      <SourceCardHeader />
      <SourceGridList
        data={data}
        onSelectSource={onSelectSource}
        onConnectSource={onConnectSource}
        onTriggerFileUpload={onTriggerFileUpload}
        onTriggerConsultant={onTriggerConsultant}
      />
      <FirstRunUploadStatus
        uploadedFileName={uploadedFileName}
        isIngesting={isIngesting}
        ingestionError={ingestionError}
        ingestionNotice={ingestionNotice}
      />
      <SourceCardActions
        source={data.selectedSource}
        onNext={onNext}
        onSkip={onSkip}
      />
    </article>
  );
}

function CityField({
  city,
  country,
  onOpenCitySheet,
  cityPicker,
}: {
  readonly city: string;
  readonly country: string;
  readonly onOpenCitySheet: () => void;
  readonly cityPicker?: ReactNode;
}): ReactElement {
  return (
    <div className="first-run-field first-run-city-field">
      <label className="first-run-label" htmlFor="context-city-picker-btn">
        Город
      </label>
      <button
        id="context-city-picker-btn"
        type="button"
        className="first-run-pick-btn"
        onClick={onOpenCitySheet}
        data-testid="context-city-picker-btn"
      >
        <span>{city}</span>
        <small className="first-run-city-country">{country}</small>
      </button>
      {cityPicker}
    </div>
  );
}

function WorkFormatField({ format, onChange }: {
  readonly format: WorkFormat;
  readonly onChange: (format: WorkFormat) => void;
}) {
  return <div className="first-run-field">
    <label className="first-run-label" htmlFor="work-format-select">Формат работы</label>
    <select id="work-format-select" className="first-run-select" value={format}
      onChange={(e) => onChange(e.target.value as WorkFormat)} data-testid="context-format-select">
      <option value="Гибрид">Гибрид</option>
      <option value="Удалённо">Удалённо</option>
      <option value="Офис">Офис</option>
    </select>
  </div>;
}

function ContextFormFields({
  data,
  onOpenCitySheet,
  cityPicker,
  onFormatChange,
  onRelocationToggle,
}: {
  readonly data: FirstRunData;
  readonly onOpenCitySheet: () => void;
  readonly cityPicker?: ReactNode;
  readonly onFormatChange: (fmt: WorkFormat) => void;
  readonly onRelocationToggle: (val: boolean) => void;
}): ReactElement {
  return (
    <>
      <CityField
        city={data.context.city}
        country={data.context.country}
        onOpenCitySheet={onOpenCitySheet}
        cityPicker={cityPicker}
      />
      <WorkFormatField format={data.context.format} onChange={onFormatChange} />
      <div className="first-run-relocation-row">
        <label className="first-run-relocation-label">
          <input
            type="checkbox"
            checked={data.context.isRelocationReady}
            onChange={(e) => onRelocationToggle(e.target.checked)}
            data-testid="context-relocation-checkbox"
          />
          Готов к релокации
        </label>
      </div>
    </>
  );
}

export function FirstRunContextCard({
  data,
  onOpenCitySheet,
  cityPicker,
  onFormatChange,
  onRelocationToggle,
  onSubmit,
}: {
  readonly data: FirstRunData;
  readonly onOpenCitySheet: () => void;
  readonly cityPicker?: ReactNode;
  readonly onFormatChange: (fmt: WorkFormat) => void;
  readonly onRelocationToggle: (val: boolean) => void;
  readonly onSubmit: () => void;
}): ReactElement {
  return (
    <article className="first-run-stage-card is-active" aria-labelledby="context-title">
      <div className="first-run-stage-head">
        <div className="first-run-stage-title-wrap">
          <span className="first-run-stage-badge">3</span>
          <h2 id="context-title" className="first-run-stage-title">
            Контекст
          </h2>
        </div>
      </div>
      <p className="first-run-context-description">
        Город и формат работы нужны для подбора. Позже их можно поменять в профиле.
      </p>
      <ContextFormFields
        data={data}
        onOpenCitySheet={onOpenCitySheet}
        cityPicker={cityPicker}
        onFormatChange={onFormatChange}
        onRelocationToggle={onRelocationToggle}
      />
      <div className="first-run-actions">
        <button
          type="button"
          className="first-run-btn-primary"
          onClick={onSubmit}
          data-testid="context-submit-btn"
        >
          Собрать профиль
        </button>
      </div>
    </article>
  );
}
