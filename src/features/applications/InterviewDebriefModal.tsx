import React, { useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  computeDebriefFollowUpDate,
  type DebriefDeadlinePreset,
} from './debriefDeadline';
import './interviewDebriefModal.css';

export type InterviewFeeling = 'positive' | 'neutral' | 'difficult';

export interface InterviewDebriefSubmitData {
  readonly feeling: InterviewFeeling;
  readonly difficultQuestions: string;
  readonly promisedResponseDate: string | null;
}

export interface InterviewDebriefModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (data: InterviewDebriefSubmitData) => void | Promise<void>;
  readonly vacancyTitle: string;
  readonly company?: string | null;
  readonly initialFeeling?: InterviewFeeling;
  readonly initialQuestions?: string;
  readonly initialPromisedDate?: string | null;
}

interface UseInterviewDebriefStateProps {
  readonly initialFeeling: InterviewFeeling;
  readonly initialQuestions: string;
  readonly initialPromisedDate: string | null;
  readonly onSave: (data: InterviewDebriefSubmitData) => void | Promise<void>;
  readonly onClose: () => void;
}

function useInterviewDebriefState(props: UseInterviewDebriefStateProps) {
  const { initialFeeling, initialQuestions, initialPromisedDate, onSave, onClose } = props;
  const [feeling, setFeeling] = useState<InterviewFeeling>(initialFeeling);
  const [questions, setQuestions] = useState(initialQuestions);
  const [promisedDate, setPromisedDate] = useState<string>(initialPromisedDate ?? '');
  const [activePreset, setActivePreset] = useState<DebriefDeadlinePreset | null>(null);
  const [saving, setSaving] = useState(false);

  const handlePresetClick = (preset: DebriefDeadlinePreset) => {
    setActivePreset(preset);
    const computed = computeDebriefFollowUpDate({
      baseDate: new Date().toISOString(),
      preset,
    });
    if (computed) setPromisedDate(computed);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        feeling,
        difficultQuestions: questions.trim(),
        promisedResponseDate: promisedDate.trim() || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return {
    feeling,
    setFeeling,
    questions,
    setQuestions,
    promisedDate,
    setPromisedDate,
    activePreset,
    setActivePreset,
    saving,
    handlePresetClick,
    handleSubmit,
  };
}

function DebriefForm({
  state,
  onClose,
}: {
  readonly state: ReturnType<typeof useInterviewDebriefState>;
  readonly onClose: () => void;
}) {
  return (
    <form className="career-debrief-form" onSubmit={state.handleSubmit}>
      <DebriefFeelingGroup feeling={state.feeling} onChange={state.setFeeling} />
      <DebriefQuestionsGroup questions={state.questions} onChange={state.setQuestions} />
      <DebriefDeadlinesGroup
        promisedDate={state.promisedDate}
        activePreset={state.activePreset}
        onSelectPreset={state.handlePresetClick}
        onChangeDate={(date) => {
          state.setActivePreset('custom');
          state.setPromisedDate(date);
        }}
      />
      <DebriefActions saving={state.saving} onClose={onClose} />
    </form>
  );
}

export function InterviewDebriefModal(props: InterviewDebriefModalProps) {
  const {
    isOpen,
    onClose,
    onSave,
    vacancyTitle,
    company,
    initialFeeling = 'positive',
    initialQuestions = '',
    initialPromisedDate = null,
  } = props;
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(onClose, isOpen);

  const state = useInterviewDebriefState({
    initialFeeling,
    initialQuestions,
    initialPromisedDate,
    onSave,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div
      className="career-debrief-modal-overlay"
      onMouseDown={(e) => {
        if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
      }}
      role="presentation"
    >
      <div
        className="career-debrief-modal-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-debrief-modal-title"
      >
        <DebriefHeader company={company} vacancyTitle={vacancyTitle} onClose={onClose} />
        <DebriefForm state={state} onClose={onClose} />
      </div>
    </div>
  );
}

function DebriefHeader({
  company,
  vacancyTitle,
  onClose,
}: {
  company?: string | null;
  vacancyTitle: string;
  onClose: () => void;
}) {
  return (
    <header className="career-debrief-modal-header">
      <div>
        <h2 id="interview-debrief-modal-title" className="career-debrief-modal-title">
          Итоги интервью
        </h2>
        <p className="career-debrief-modal-subtitle">
          {vacancyTitle}{company ? ` · ${company}` : ''}
        </p>
      </div>
      <button
        type="button"
        className="career-btn-icon"
        onClick={onClose}
        aria-label="Закрыть"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </header>
  );
}

function DebriefFeelingGroup({
  feeling,
  onChange,
}: {
  feeling: InterviewFeeling;
  onChange: (val: InterviewFeeling) => void;
}) {
  const options: Array<{ id: InterviewFeeling; label: string }> = [
    { id: 'positive', label: 'Хорошее' },
    { id: 'neutral', label: 'Нейтральное' },
    { id: 'difficult', label: 'Трудное' },
  ];

  return (
    <div className="career-debrief-field">
      <span className="career-debrief-label" id="feeling-group-label">
        Как прошло собеседование
      </span>
      <div className="career-debrief-feeling-options" role="radiogroup" aria-labelledby="feeling-group-label">
        {options.map((opt) => (
          <label
            key={opt.id}
            className={`career-debrief-feeling-pill${feeling === opt.id ? ' is-selected' : ''}`}
          >
            <input
              type="radio"
              name="feeling"
              value={opt.id}
              checked={feeling === opt.id}
              onChange={() => onChange(opt.id)}
              className="career-visually-hidden"
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function DebriefQuestionsGroup({
  questions,
  onChange,
}: {
  questions: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="career-debrief-field">
      <label htmlFor="debrief-questions-input" className="career-debrief-label">
        Трудные вопросы
      </label>
      <textarea
        id="debrief-questions-input"
        className="career-debrief-textarea"
        rows={3}
        value={questions}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Какие темы или вопросы вызвали сложность и требуют повторения?"
      />
    </div>
  );
}

function DebriefDeadlinesGroup({
  promisedDate,
  activePreset,
  onSelectPreset,
  onChangeDate,
}: {
  promisedDate: string;
  activePreset: DebriefDeadlinePreset | null;
  onSelectPreset: (preset: DebriefDeadlinePreset) => void;
  onChangeDate: (date: string) => void;
}) {
  return (
    <div className="career-debrief-field">
      <label htmlFor="debrief-date-input" className="career-debrief-label">
        Обещанный срок ответа
      </label>
      <div className="career-debrief-preset-row">
        <button
          type="button"
          className={`career-btn career-btn-sm ${activePreset === '3_days' ? 'career-btn-primary' : 'career-btn-secondary'}`}
          onClick={() => onSelectPreset('3_days')}
        >
          3 рабочих дня
        </button>
        <button
          type="button"
          className={`career-btn career-btn-sm ${activePreset === '5_days' ? 'career-btn-primary' : 'career-btn-secondary'}`}
          onClick={() => onSelectPreset('5_days')}
        >
          5 рабочих дней
        </button>
      </div>
      <input
        id="debrief-date-input"
        type="date"
        className="career-debrief-date-input"
        value={promisedDate}
        onChange={(e) => onChangeDate(e.target.value)}
      />
      <span className="career-debrief-hint">
        Когда срок наступит, в «Сегодня» появится черновик напоминания компании.
      </span>
    </div>
  );
}

function DebriefActions({
  saving,
  onClose,
}: {
  saving: boolean;
  onClose: () => void;
}) {
  return (
    <div className="career-debrief-modal-actions">
      <button
        type="button"
        className="career-btn career-btn-secondary"
        onClick={onClose}
        disabled={saving}
      >
        Отмена
      </button>
      <button
        type="submit"
        className="career-btn career-btn-primary"
        disabled={saving}
      >
        {saving ? 'Сохраняем…' : 'Сохранить дебрифинг'}
      </button>
    </div>
  );
}
