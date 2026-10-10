import type { CSSProperties, ReactElement } from 'react';
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
        className="first-run-btn-primary"
        style={{ alignSelf: 'flex-start', marginTop: '8px' }}
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
            <PencilSimple size={14} style={{ marginRight: '4px' }} />
            Изменить
          </button>
        ) : null}
      </div>
      {isEditing ? (
        <GoalEditForm goal={goal} onGoalChange={onGoalChange} onSave={onSaveEdit} />
      ) : (
        <p style={{ margin: 0, fontSize: 'var(--career-text-sm, 14px)', lineHeight: 1.5 }}>{goal}</p>
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
      onClick={onPick}
      data-testid={`source-opt-${type}`}
    >
      <span className="first-run-source-ico">{icons[type]}</span>
      <div className="first-run-source-info">
        <b>{title}</b>
        <p>{desc}</p>
      </div>
      <span
        className={isPicked ? 'first-run-btn-primary' : 'first-run-btn-ghost'}
        style={{ padding: '6px 14px', pointerEvents: 'none' }}
      >
        {btnText}
      </span>
      <span style={{ width: '20px', display: 'flex', justifyContent: 'center' }}>
        {isPicked ? <Check size={18} color="var(--career-color-primary, #0284c7)" /> : null}
      </span>
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

function SourceGridList({
  data,
  onSelectSource,
  onTriggerFileUpload,
  onTriggerConsultant,
}: {
  readonly data: FirstRunData;
  readonly onSelectSource: (s: SourceType) => void;
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
        className="first-run-btn-primary"
        onClick={onNext}
        data-testid="source-next-btn"
      >
        {source === 'linkedin' ? 'Подключить LinkedIn' : 'Далее'}
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
}

const UPLOAD_BADGE_STYLE: CSSProperties = {
  marginTop: '12px',
  padding: '8px 12px',
  background: 'var(--career-color-primary-surface, #f0f9ff)',
  borderRadius: '8px',
  fontSize: 'var(--career-text-sm, 13px)',
};

function FirstRunUploadStatus({
  uploadedFileName,
  isIngesting,
  ingestionError,
}: FirstRunUploadStatusProps): ReactElement | null {
  if (!uploadedFileName && !isIngesting && !ingestionError) return null;
  return (
    <>
      {uploadedFileName ? (
        <div className="first-run-uploaded-file-badge" data-testid="uploaded-file-info" style={UPLOAD_BADGE_STYLE}>
          <span>Файл резюме: <b>{uploadedFileName}</b></span>
        </div>
      ) : null}
      {isIngesting ? (
        <p style={{ marginTop: '8px', fontSize: 'var(--career-text-sm, 13px)', color: 'var(--career-color-primary, #0284c7)' }}>
          Обрабатываем файл резюме...
        </p>
      ) : null}
      {ingestionError ? (
        <p style={{ marginTop: '8px', fontSize: 'var(--career-text-sm, 13px)', color: 'var(--career-color-error, #ef4444)' }}>
          {ingestionError}
        </p>
      ) : null}
    </>
  );
}

export function FirstRunSourceCard({
  data,
  uploadedFileName,
  isIngesting,
  ingestionError,
  onSelectSource,
  onTriggerFileUpload,
  onTriggerConsultant,
  onNext,
  onSkip,
}: {
  readonly data: FirstRunData;
  readonly uploadedFileName?: string;
  readonly isIngesting?: boolean;
  readonly ingestionError?: string | null;
  readonly onSelectSource: (s: SourceType) => void;
  readonly onTriggerFileUpload: () => void;
  readonly onTriggerConsultant: () => void;
  readonly onNext: () => void;
  readonly onSkip: () => void;
}): ReactElement {
  return (
    <article className="first-run-stage-card is-active" aria-labelledby="source-title">
      <div className="first-run-stage-head">
        <div className="first-run-stage-title-wrap">
          <span className="first-run-stage-badge">2</span>
          <h2 id="source-title" className="first-run-stage-title">
            Источник
          </h2>
        </div>
      </div>
      <SourceGridList
        data={data}
        onSelectSource={onSelectSource}
        onTriggerFileUpload={onTriggerFileUpload}
        onTriggerConsultant={onTriggerConsultant}
      />
      <FirstRunUploadStatus
        uploadedFileName={uploadedFileName}
        isIngesting={isIngesting}
        ingestionError={ingestionError}
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
}: {
  readonly city: string;
  readonly country: string;
  readonly onOpenCitySheet: () => void;
}): ReactElement {
  return (
    <div className="first-run-field">
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
        <small style={{ color: 'var(--career-color-muted, #94a3b8)' }}>{country}</small>
      </button>
    </div>
  );
}

function ContextFormFields({
  data,
  onOpenCitySheet,
  onFormatChange,
  onRelocationToggle,
}: {
  readonly data: FirstRunData;
  readonly onOpenCitySheet: () => void;
  readonly onFormatChange: (fmt: WorkFormat) => void;
  readonly onRelocationToggle: (val: boolean) => void;
}): ReactElement {
  return (
    <>
      <CityField
        city={data.context.city}
        country={data.context.country}
        onOpenCitySheet={onOpenCitySheet}
      />
      <div className="first-run-field">
        <label className="first-run-label" htmlFor="work-format-select">
          Формат работы
        </label>
        <select
          id="work-format-select"
          className="first-run-select"
          value={data.context.format}
          onChange={(e) => onFormatChange(e.target.value as WorkFormat)}
          data-testid="context-format-select"
        >
          <option value="Гибрид">Гибрид</option>
          <option value="Удалённо">Удалённо</option>
          <option value="Офис">Офис</option>
        </select>
      </div>
      <div style={{ marginTop: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 'var(--career-text-sm, 14px)' }}>
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
  onFormatChange,
  onRelocationToggle,
  onSubmit,
}: {
  readonly data: FirstRunData;
  readonly onOpenCitySheet: () => void;
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
      <p style={{ margin: '0 0 16px', fontSize: 'var(--career-text-sm, 13px)', color: 'var(--career-color-sub, #64748b)' }}>
        Город и формат работы нужны для подбора. Позже их можно поменять в профиле.
      </p>
      <ContextFormFields
        data={data}
        onOpenCitySheet={onOpenCitySheet}
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
