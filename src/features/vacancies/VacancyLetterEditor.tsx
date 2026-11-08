import { useEffect, useRef } from 'react';
import {
  CaretDown,
  ChatCircleText,
  CircleNotch,
  WarningCircle,
} from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { LetterDraftState } from './vacancyLetterController';
import type { ConnectionCircleNumber } from './vacancyLetterApi';
import type { VacancyPitchPayload, VacancyPitchResult } from './vacancyPitchApi';
import { useCompactViewport } from './useCompactViewport';
import { useAutoGrowTextarea } from './useLetterViewport';

type PitchTone = NonNullable<VacancyPitchPayload['tone']>;
type PitchLanguage = NonNullable<VacancyPitchPayload['language']>;

const TONE_OPTIONS: readonly { readonly id: PitchTone; readonly label: string }[] = [
  { id: 'executive', label: 'Деловой' },
  { id: 'confident', label: 'Тёплый' },
  { id: 'technical', label: 'Технический' },
];

const LANGUAGE_OPTIONS: readonly { readonly id: 'auto' | PitchLanguage; readonly label: string }[] =
  [
    { id: 'auto', label: 'Определить по вакансии' },
    { id: 'ru', label: 'Русский' },
    { id: 'en', label: 'English' },
  ];

const CHANNEL_LABEL: Readonly<Record<ConnectionCircleNumber, string>> = {
  1: 'сообщение знакомому',
  2: 'просьба представить',
  3: 'письмо к отклику',
};

function LetterSelect<Value extends string>({
  label,
  value,
  frozen,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: Value;
  readonly frozen: boolean;
  readonly options: readonly { readonly id: Value; readonly label: string }[];
  readonly onChange: (value: Value) => void;
}) {
  return (
    <label>
      {label}
      <span className="career-letter-select">
        <select
          value={value}
          disabled={frozen}
          onChange={(event) => onChange(event.currentTarget.value as Value)}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <CaretDown className="career-letter-select-caret" size={16} aria-hidden="true" />
      </span>
    </label>
  );
}

export function LetterSettings({
  language,
  tone,
  frozen,
  onLanguage,
  onTone,
}: {
  readonly language: 'auto' | PitchLanguage;
  readonly tone: PitchTone;
  readonly frozen: boolean;
  readonly onLanguage: (language: 'auto' | PitchLanguage) => void;
  readonly onTone: (tone: PitchTone) => void;
}) {
  return (
    <div className="career-letter-settings">
      <h3 className="career-letter-cap">Письмо</h3>
      <LetterSelect
        label="Язык"
        value={language}
        frozen={frozen}
        options={LANGUAGE_OPTIONS}
        onChange={onLanguage}
      />
      <LetterSelect
        label="Тон"
        value={tone}
        frozen={frozen}
        options={TONE_OPTIONS}
        onChange={onTone}
      />
    </div>
  );
}

export function PitchBodyState({ draft }: { readonly draft: LetterDraftState }) {
  const errorRef = useRef<HTMLDivElement>(null);
  // Ошибка стоит под настройками: на 390 её иначе не видно, кандидат решит, что письмо ещё готовится.
  useEffect(() => {
    if (draft.error) errorRef.current?.scrollIntoView?.({ block: 'center' });
  }, [draft.error]);
  if (draft.loading) {
    return (
      <p className="career-letter-loading" role="status" aria-busy="true">
        <CircleNotch size={16} className="career-spin" aria-hidden="true" /> Письмо готовится по
        профилю и вакансии…
      </p>
    );
  }
  if (draft.error) {
    return (
      <div ref={errorRef} className="career-letter-error" role="alert">
        <WarningCircle size={16} aria-hidden="true" />
        <p>{draft.error}</p>
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          onClick={draft.retry}
        >
          Повторить
        </button>
      </div>
    );
  }
  return null;
}

export function wordCountLabel(count: number): string {
  return pluralRu(count, ['слово', 'слова', 'слов']);
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

export function LetterEditor({
  draft,
  circle,
  senderName,
  frozen,
  onEdit,
}: {
  readonly draft: LetterDraftState;
  readonly circle: ConnectionCircleNumber;
  readonly senderName: string | null;
  readonly frozen: boolean;
  readonly onEdit: () => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const compact = useCompactViewport();
  useAutoGrowTextarea(areaRef, draft.text);
  return (
    <div className="career-letter-editor">
      <label htmlFor="career-letter-body">Текст письма</label>
      <textarea
        id="career-letter-body"
        ref={areaRef}
        value={draft.text}
        readOnly={frozen}
        rows={compact ? 2 : 12}
        onChange={(event) => {
          onEdit();
          draft.setText(event.currentTarget.value);
        }}
      />
      <p className="career-letter-meta">
        <span>{wordCountLabel(wordCount(draft.text))}</span>
        <span>
          {compact ? 'длина' : 'Длина'} подобрана под канал: {CHANNEL_LABEL[circle]}
        </span>
        {senderName ? (
          <span>
            {compact ? 'от' : 'От'} имени: {senderName}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Под письмом в макете 9 — одна строка «слов · длина · от имени». Примечаний без действия нет (B623):
 * ни «сверьте с профилем», ни «N требований не подтверждены». Остаётся нехватка фактов с кнопкой
 * «Собрать факты с консультантом» и примечание шаблонного текста, если сервер его прислал.
 */
export function LetterNotices({
  pitch,
  onGatherFacts,
}: {
  readonly pitch: VacancyPitchResult;
  readonly onGatherFacts?: () => void;
}) {
  // Письму модели сервер примечаний не шлёт (B623); на всякий случай они не показываются ни в одном круге.
  const notice = pitch.bodySource === 'model' ? undefined : pitch.notices?.[0];
  if (pitch.usedEvidenceIds.length === 0 && pitch.bodySource !== 'model') {
    return (
      <div className="career-letter-notes">
        <p role="status">
          <span>
            {pitch.language === 'en'
              ? 'The profile has too few confirmed facts: the letter adds no achievements without a source.'
              : 'В профиле мало подтверждённых фактов: письмо не добавляет достижения без источника.'}
          </span>
          {onGatherFacts ? (
            <button type="button" className="career-btn is-sm is-ghost" onClick={onGatherFacts}>
              <ChatCircleText size={16} aria-hidden="true" />
              Собрать факты с консультантом
            </button>
          ) : null}
        </p>
      </div>
    );
  }
  if (!notice) return null;
  return (
    <div className="career-letter-notes">
      <p>{notice}</p>
    </div>
  );
}
