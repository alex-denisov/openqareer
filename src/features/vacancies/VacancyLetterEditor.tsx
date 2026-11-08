import { useEffect, useRef } from 'react';
import {
  CaretDown,
  Check,
  ChatCircleText,
  CircleNotch,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import type { LetterDraftState } from './vacancyLetterController';
import type { CandidateWorkplaceForLetter, ConnectionCircleNumber } from './vacancyLetterApi';
import type { VacancyPitchPayload, VacancyPitchResult } from './vacancyPitchApi';
import { LetterInfoTip } from './VacancyLetterInfoTip';
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

/** Сноску читает кандидат, поэтому она на русском при любом языке письма. */
function requirementsNote(count: number): string {
  const last = count % 10;
  const tens = count % 100;
  const few = last >= 2 && last <= 4 && (tens < 12 || tens > 14);
  if (last === 1 && tens !== 11)
    return `${count} требование вакансии не подтверждено фактами профиля`;
  return `${count} ${few ? 'требования' : 'требований'} вакансии не подтверждены фактами профиля`;
}

function UnconfirmedRequirementsNote({ labels }: { readonly labels: readonly string[] }) {
  return (
    <details className="career-letter-requirements">
      <summary>{requirementsNote(labels.length)}</summary>
      <ul>
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Под письмом в макете 9 — одна строка «слов · длина · от имени». Сигнал о
 * фактах остаётся, но одной короткой заметкой, самой полезной (G3 L2, 03.11).
 */
export function LetterNotices({
  pitch,
  circle = 3,
  onGatherFacts,
}: {
  readonly pitch: VacancyPitchResult;
  readonly circle?: ConnectionCircleNumber;
  readonly onGatherFacts?: () => void;
}) {
  // Круги 1 и 2 показывают короткое сообщение, а не письмо модели: предупреждение о его фактах там не к месту.
  const notice = pitch.bodySource === 'model' && circle !== 3 ? undefined : pitch.notices?.[0];
  const unconfirmed = pitch.unconfirmedRequirements ?? [];
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
  if (!notice && unconfirmed.length === 0) return null;
  return (
    <div className="career-letter-notes">
      {notice ? <p>{notice}</p> : <UnconfirmedRequirementsNote labels={unconfirmed} />}
    </div>
  );
}

function yearOf(date: string | null): string {
  return date?.match(/\d{4}/u)?.[0] ?? '';
}

export function workplaceRange(workplace: CandidateWorkplaceForLetter): string {
  return [yearOf(workplace.startDate), workplace.current ? 'сейчас' : yearOf(workplace.endDate)]
    .filter(Boolean)
    .join(' — ');
}

export function factsLabel(count: number): string {
  const last = count % 10;
  const tens = count % 100;
  if (last === 1 && tens !== 11) return `${count} подтверждённый факт`;
  const word = last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? 'факта' : 'фактов';
  return `${count} подтверждённых ${word}`;
}

/**
 * Отметки ставит правило: все места с подтверждёнными фактами (`useWorkplaceSelection`).
 * Ни консультант, ни сравнение с вакансией в выборе не участвуют — о них подпись не говорит.
 */
const WORKPLACES_CHIP = 'Отмечены места с фактами';
const WORKPLACES_FOOT =
  'Отмечены все места с подтверждёнными фактами. Снимите отметку: письмо пересоберётся без этого места.';

function WorkplaceRow({
  workplace,
  checked,
  frozen,
  onToggle,
}: {
  readonly workplace: CandidateWorkplaceForLetter;
  readonly checked: boolean;
  readonly frozen: boolean;
  readonly onToggle: () => void;
}) {
  const range = workplaceRange(workplace);
  const count = workplace.evidenceIds.length;
  return (
    <li>
      <label>
        <input
          type="checkbox"
          checked={checked}
          disabled={frozen || count === 0}
          onChange={onToggle}
        />
        <span className="career-letter-job-copy">
          <strong>{workplace.employer ?? 'Работодатель не указан'}</strong>
          {' · '}
          {workplace.title ?? 'Должность не указана'}
          {range ? ', ' + range : ''}
          <small>
            {count === 0
              ? 'Нет подтверждённых фактов для письма'
              : `Для письма доступно: ${factsLabel(count)} из этого места`}
          </small>
        </span>
        <Check className="career-letter-job-tick" size={20} aria-hidden="true" />
      </label>
    </li>
  );
}

export function WorkplaceList({
  workplaces,
  includedIds,
  frozen,
  onToggle,
}: {
  readonly workplaces: readonly CandidateWorkplaceForLetter[];
  readonly includedIds: readonly string[];
  readonly frozen: boolean;
  readonly onToggle: (id: string) => void;
}) {
  return (
    <section
      className="career-letter-block career-letter-workplaces"
      aria-label="Места работы в письме"
    >
      <div className="career-letter-sub-head">
        <h3>Места работы в письме</h3>
        <span className="career-letter-chip is-hyp">
          <Sparkle size={14} aria-hidden="true" />
          {WORKPLACES_CHIP}
        </span>
        <LetterInfoTip text="Отмеченные места работы войдут в письмо. Снимите или поставьте галочку: текст письма пересоберётся. Источник: Профиль, Опыт." />
      </div>
      {workplaces.length === 0 ? (
        <p className="career-letter-muted">
          В профиле нет подтверждённых мест работы. Письмо не будет добавлять неподтверждённый опыт.
        </p>
      ) : (
        <ul>
          {workplaces.map((workplace) => (
            <WorkplaceRow
              key={workplace.id}
              workplace={workplace}
              checked={includedIds.includes(workplace.id)}
              frozen={frozen}
              onToggle={() => onToggle(workplace.id)}
            />
          ))}
        </ul>
      )}
      {workplaces.length > 0 ? <p className="career-letter-foot">{WORKPLACES_FOOT}</p> : null}
    </section>
  );
}
