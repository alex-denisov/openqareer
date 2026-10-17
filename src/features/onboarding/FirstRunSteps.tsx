import type { ReactElement, ReactNode } from 'react';
import {
  Briefcase,
  ChatCircleText,
  Check,
  LinkedinLogo,
  PencilSimple,
  UploadSimple,
  LockSimple,
  Info,
  SignIn,
  CaretRight,
  CaretDown,
} from '@phosphor-icons/react';
import { CareerTooltip } from '../shell/CareerTooltip';
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
    <div className="first-run-field first-run-goal-form">
      <p className="first-run-goal-lead">
        Что вы хотите от поиска? Одной фразой, потом её можно изменить.
      </p>
      <div className="first-run-goal-input">
        <div className="first-run-goal-mirror" aria-hidden="true">
          {goal + ' '}
        </div>
        <textarea
          className="first-run-textarea"
          rows={2}
          value={goal}
          onChange={(e) => onGoalChange(e.target.value)}
          aria-label="Ваша цель"
          data-testid="goal-textarea"
        />
      </div>
      <button
        type="button"
        className="first-run-btn-ghost first-run-btn-save-goal"
        onClick={onSave}
        disabled={!goal.trim()}
        data-testid="save-goal-btn"
      >
        <span className="first-run-desktop-label">Сохранить</span>
        <span className="first-run-mobile-label">Далее</span>
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
    <article
      className={`first-run-stage-card${isEditing ? ' is-active' : ' is-done'}`}
      aria-labelledby="goal-title"
    >
      <div className="first-run-stage-head">
        <div className="first-run-stage-title-wrap">
          <span className={`first-run-stage-badge${isEditing ? '' : ' is-done'}`}>
            {isEditing ? '1' : <Check size={16} />}
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
  disabled = false,
}: {
  readonly type: SourceType;
  readonly title: string;
  readonly desc: string;
  readonly btnText: string;
  readonly isPicked: boolean;
  readonly onPick: () => void;
  readonly disabled?: boolean;
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
      disabled={disabled}
      onClick={onPick}
      data-testid={`source-opt-${type}`}
    >
      <span className="first-run-source-ico">{icons[type]}</span>
      <div className="first-run-source-info">
        <b>{title}</b>
        <p>{desc}</p>
      </div>
      <span className={`first-run-source-action-label${isPicked ? ' is-selected' : ''}`}>
        {isPicked && (type === 'linkedin' || type === 'hh') ? (
          <SignIn size={18} aria-hidden="true" />
        ) : null}
        {btnText}
      </span>
      <span className="first-run-source-check">{isPicked ? <Check size={18} /> : null}</span>
    </button>
  );
}

const SOURCE_ITEMS = [
  {
    type: 'linkedin' as const,
    title: 'LinkedIn',
    desc: 'Места работы, образование, навыки, языки, проекты, курсы, контакты',
    btnText: 'Подключить',
  },
  {
    type: 'hh' as const,
    title: 'hh.ru',
    desc: 'Резюме с hh.ru: места работы, навыки, образование',
    btnText: 'Подключить',
  },
  {
    type: 'file' as const,
    title: 'Файл резюме',
    desc: 'PDF или DOCX, до 10 МБ',
    btnText: 'Загрузить',
  },
  {
    type: 'talk' as const,
    title: 'Рассказать консультанту',
    desc: 'Без подключений: ответите на вопросы, профиль соберём из ответов',
    btnText: 'Начать',
  },
] as const;

function SourceGridList(props: FirstRunSourceCardProps): ReactElement {
  return (
    <div className="first-run-source-grid">
      {SOURCE_ITEMS.map((item) => (
        <SourceOptionRow
          key={item.type}
          type={item.type}
          title={item.title}
          desc={item.desc}
          btnText={
            item.type === 'file' &&
            props.uploadedFileName &&
            !props.ingestionError &&
            !props.isIngesting
              ? 'Продолжить'
              : item.btnText
          }
          isPicked={props.data.selectedSource === item.type}
          disabled={props.isIngesting}
          onPick={() => {
            props.onSelectSource(item.type);
            if (!props.isMobile)
              activateSource({ ...props, data: { ...props.data, selectedSource: item.type } });
          }}
        />
      ))}
    </div>
  );
}

function SourceCardActions({
  source,
  label,
  busy,
  onNext,
  onSkip,
}: {
  readonly source: SourceType | null;
  readonly label?: string;
  readonly busy?: boolean;
  readonly onNext: () => void;
  readonly onSkip: () => void;
}): ReactElement {
  return (
    <div className="first-run-actions">
      <button
        type="button"
        className="first-run-btn-ghost"
        onClick={onNext}
        disabled={!source || busy}
        data-testid="source-next-btn"
      >
        {label ??
          (source === 'linkedin'
            ? 'Подключить LinkedIn'
            : source === 'hh'
              ? 'Подключить hh.ru'
              : source === 'file'
                ? 'Продолжить с файлом'
                : source === 'talk'
                  ? 'Рассказать консультанту'
                  : 'Продолжить')}
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
          <span>
            Файл резюме: <b>{uploadedFileName}</b>
          </span>
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
      <CareerTooltip content="Выберите, откуда взять данные о вас. Подключить можно позже.">
        <button type="button" className="first-run-source-help" aria-label="Пояснение">
          <Info size={16} aria-hidden="true" />
        </button>
      </CareerTooltip>
    </div>
  );
}

interface FirstRunSourceCardProps {
  readonly data: FirstRunData;
  readonly isMobile?: boolean;
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
}

function activateSource(
  props: Pick<
    FirstRunSourceCardProps,
    | 'data'
    | 'uploadedFileName'
    | 'ingestionError'
    | 'onConnectSource'
    | 'onTriggerFileUpload'
    | 'onTriggerConsultant'
    | 'onNext'
  >,
) {
  const source = props.data.selectedSource;
  if (source === 'linkedin' || source === 'hh') props.onConnectSource?.(source);
  else if (source === 'file' && (!props.uploadedFileName || props.ingestionError))
    props.onTriggerFileUpload();
  else if (source === 'talk') props.onTriggerConsultant();
  else props.onNext();
}

function SourcePrivacy() {
  return (
    <p className="first-run-source-privacy">
      <LockSimple size={16} aria-hidden="true" />
      <span>
        Подключение можно отключить в любой момент. Отправлять что-либо от вашего имени без вашего
        одобрения мы не будем.
      </span>
    </p>
  );
}

function SourceCardFooter(props: FirstRunSourceCardProps) {
  return (
    <>
      <FirstRunUploadStatus {...props} />
      <SourcePrivacy />
      {props.isMobile ? (
        <SourceCardActions
          source={props.data.selectedSource}
          label={
            props.data.selectedSource === 'file' &&
            (!props.uploadedFileName || props.ingestionError)
              ? 'Загрузить резюме'
              : undefined
          }
          busy={props.isIngesting}
          onNext={() => activateSource(props)}
          onSkip={props.onSkip}
        />
      ) : null}
    </>
  );
}

export function FirstRunSourceCard(props: FirstRunSourceCardProps): ReactElement {
  return (
    <article className="first-run-stage-card is-active" aria-labelledby="source-title">
      <SourceCardHeader />
      <p className="first-run-source-lead">
        Выберите, откуда взять данные о вас. Подключить можно позже.
      </p>
      <SourceGridList {...props} />
      <SourceCardFooter {...props} />
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
        <span>{city || 'Выбрать город'}</span>
        <small className="first-run-city-country">{country}</small>
        <CaretRight className="first-run-city-caret" size={14} aria-hidden="true" />
      </button>
      {cityPicker}
    </div>
  );
}

function WorkFormatField({
  format,
  onChange,
}: {
  readonly format: WorkFormat;
  readonly onChange: (format: WorkFormat) => void;
}) {
  return (
    <div className="first-run-field">
      <label className="first-run-label" htmlFor="work-format-select">
        Формат работы
      </label>
      <span className="first-run-format-control">
        <select
          id="work-format-select"
          className="first-run-select"
          value={format}
          onChange={(e) => onChange(e.target.value as WorkFormat)}
          data-testid="context-format-select"
        >
          <option value="" disabled hidden>
            Не указан
          </option>
          <option value="Гибрид">Гибрид</option>
          <option value="Удалённо">Удалённо</option>
          <option value="Офис">Офис</option>
        </select>
        <CaretDown className="first-run-format-caret" size={14} aria-hidden="true" />
      </span>
    </div>
  );
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
    <div className="first-run-context-fields">
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
    </div>
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
