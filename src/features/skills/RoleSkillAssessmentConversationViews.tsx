import { useState, type FormEvent, type RefObject, type SetStateAction } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { VoiceInput } from '../coach/VoiceInput';
import type { VoiceInputState } from '../coach/voiceInputMachine';
import type { RoleSkillAssessmentMutationResult } from './roleSkillAssessmentApi';

type SuggestionDecision = { accepted: boolean; statement: string };
type AssessmentRun = RoleSkillAssessmentMutationResult['run'];

export function DialogueState(props: {
  run: AssessmentRun;
  question: string;
  answer: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onVoiceSubmit: (value: string) => Promise<boolean>;
  onShowSkills: () => void;
  inputRef: RefObject<HTMLTextAreaElement>;
}) {
  return (
    <section className="career-role-assessment-card career-role-assessment-dialogue">
      <DialogueHeader run={props.run} />
      <DialogueActions run={props.run} onShowSkills={props.onShowSkills} />
      <DialogueTranscript run={props.run} question={props.question} />
      {props.run.currentDialogueIndex < 3 ? <DialogueComposer {...props} /> : <PendingDialogue />}
    </section>
  );
}

function DialogueActions({ run, onShowSkills }: { run: AssessmentRun; onShowSkills: () => void }) {
  return (
    <div className="career-role-assessment-dialogue-action-area">
      <div className="career-role-assessment-dialogue-actions">
        <button className="career-quiet-button" type="button" onClick={onShowSkills}>
          Навыки {run.readiness.confirmedCount}/5
        </button>
        <button
          className="career-quiet-button"
          type="button"
          disabled
          title="Кейсы доступны после завершения диалога и решения по предложениям."
        >
          К кейсам
        </button>
        <button
          className="career-quiet-button"
          type="button"
          disabled
          title="Пропуск вопроса не поддержан проверкой роли."
        >
          Пропустить
        </button>
      </div>
      <p className="career-role-assessment-dialogue-action-note">
        Ответьте на три вопроса, затем решите, какие факты добавить в профиль. Отдельный пропуск
        вопроса недоступен.
      </p>
    </div>
  );
}

function DialogueHeader({ run }: { run: AssessmentRun }) {
  return (
    <div className="career-role-assessment-card-heading">
      <div>
        <span className="career-role-assessment-tag">
          Шаг {Math.min(run.currentDialogueIndex + 1, 3)} из 3
        </span>
        <h2>Уточним ваш опыт</h2>
      </div>
      <span className="career-role-assessment-meta">Сохранённый ответ можно продолжить</span>
    </div>
  );
}

function DialogueTranscript({ run, question }: { run: AssessmentRun; question: string }) {
  return (
    <div className="career-role-assessment-transcript" aria-live="polite">
      {run.dialogueEntries.map((entry) => (
        <article key={entry.id}>
          <span>{entry.question}</span>
          <p>{entry.answer}</p>
        </article>
      ))}
      {run.currentDialogueIndex < 3 ? (
        <article className="is-current">
          <span>Консультант</span>
          <p>{question}</p>
        </article>
      ) : (
        <p>Ответы сохранены. Готовим предложения для профиля…</p>
      )}
    </div>
  );
}

function DialogueComposer({
  answer,
  busy,
  onChange,
  onSubmit,
  onVoiceSubmit,
  inputRef,
}: {
  answer: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onVoiceSubmit: (value: string) => Promise<boolean>;
  inputRef: RefObject<HTMLTextAreaElement>;
}) {
  return (
    <form className="career-role-assessment-composer" onSubmit={submitDialogue(onSubmit)}>
      <label className="career-role-assessment-sr-only" htmlFor="role-assessment-dialogue-answer">
        Ваш ответ
      </label>
      <textarea
        ref={inputRef}
        id="role-assessment-dialogue-answer"
        value={answer}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Напишите ответ на вопрос…"
        rows={3}
        maxLength={8000}
        disabled={busy}
      />
      <DialogueComposerActions
        answer={answer}
        busy={busy}
        onChange={onChange}
        onVoiceSubmit={onVoiceSubmit}
        inputRef={inputRef}
      />
    </form>
  );
}

function submitDialogue(onSubmit: () => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
}

function DialogueComposerActions({
  answer,
  busy,
  onChange,
  onVoiceSubmit,
  inputRef,
}: {
  answer: string;
  busy: boolean;
  onChange: (value: string) => void;
  onVoiceSubmit: (value: string) => Promise<boolean>;
  inputRef: RefObject<HTMLTextAreaElement>;
}) {
  const [voiceState, setVoiceState] = useState<VoiceInputState>('idle');
  return (
    <div className="career-role-assessment-composer-actions">
      <VoiceInput
        value={answer}
        disabled={busy}
        onChange={onChange}
        onStateChange={setVoiceState}
        onVoiceDraftChange={() => undefined}
        onSubmitVoice={onVoiceSubmit}
        onTextMode={() => inputRef.current?.focus()}
      />
      <span>{answer.length}/8000</span>
      {answer.trim() && voiceState === 'idle' ? (
        <button className="career-primary-button" type="submit" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Ответить'} <ArrowRight size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function PendingDialogue() {
  return (
    <p className="career-role-assessment-pending">
      Ответы сохранены. Предложения загружаются автоматически.
    </p>
  );
}

export function SuggestionsState(props: {
  run: AssessmentRun;
  drafts: Record<string, SuggestionDecision>;
  busy: boolean;
  onDrafts: (next: SetStateAction<Record<string, SuggestionDecision>>) => void;
  onSetAll: (accepted: boolean) => void;
  onAcceptAll: () => void;
  onSave: () => void;
}) {
  const selectedCount = props.run.suggestions.filter(
    (suggestion) => props.drafts[suggestion.id]?.accepted,
  ).length;
  const totalCount = props.run.suggestions.length;
  return (
    <section className="career-role-assessment-card career-role-assessment-suggestions">
      <SuggestionsHeader />
      <p className="career-role-assessment-lead">
        Предложения основаны на ваших ответах. В профиль попадут только выбранные факты.
      </p>
      <p className="career-role-assessment-suggestion-count" aria-live="polite">
        Предлагается: {totalCount} из 12 · Отмечено: {selectedCount}
      </p>
      <div className="career-role-assessment-suggestion-list">
        {props.run.suggestions.map((suggestion, index) => (
          <SuggestionItem
            key={suggestion.id}
            index={index}
            suggestion={suggestion}
            drafts={props.drafts}
            onDrafts={props.onDrafts}
          />
        ))}
      </div>
      <SuggestionActions {...props} selectedCount={selectedCount} />
    </section>
  );
}

function SuggestionsHeader() {
  return (
    <div className="career-role-assessment-card-heading">
      <div>
        <span className="career-role-assessment-tag">По итогам диалога</span>
        <h2>Что добавить в профиль</h2>
      </div>
      <span className="career-role-assessment-meta">Можно исправить перед принятием</span>
    </div>
  );
}

function SuggestionItem({
  index,
  suggestion,
  drafts,
  onDrafts,
}: {
  index: number;
  suggestion: AssessmentRun['suggestions'][number];
  drafts: Record<string, SuggestionDecision>;
  onDrafts: (next: SetStateAction<Record<string, SuggestionDecision>>) => void;
}) {
  const draft = drafts[suggestion.id] ?? { accepted: false, statement: suggestion.statement };
  return (
    <label className="career-role-assessment-suggestion">
      <input
        type="checkbox"
        checked={draft.accepted}
        onChange={(event) =>
          updateSuggestion(drafts, suggestion, onDrafts, { accepted: event.currentTarget.checked })
        }
      />
      <span className="career-role-assessment-suggestion-number">{index + 1}</span>
      <span className="career-role-assessment-suggestion-body">
        <strong>{suggestion.domain}</strong>
        <textarea
          aria-label={`Поправить предложение ${index + 1}`}
          value={draft.statement}
          maxLength={1000}
          onChange={(event) =>
            updateSuggestion(drafts, suggestion, onDrafts, { statement: event.currentTarget.value })
          }
        />
      </span>
    </label>
  );
}

function updateSuggestion(
  drafts: Record<string, SuggestionDecision>,
  suggestion: AssessmentRun['suggestions'][number],
  onDrafts: (next: SetStateAction<Record<string, SuggestionDecision>>) => void,
  change: Partial<SuggestionDecision>,
): void {
  onDrafts({
    ...drafts,
    [suggestion.id]: {
      ...drafts[suggestion.id],
      accepted: drafts[suggestion.id]?.accepted ?? false,
      statement: drafts[suggestion.id]?.statement ?? suggestion.statement,
      ...change,
    },
  });
}

function SuggestionActions({
  busy,
  onSetAll,
  onAcceptAll,
  onSave,
  selectedCount,
}: {
  busy: boolean;
  onSetAll: (accepted: boolean) => void;
  onAcceptAll: () => void;
  onSave: () => void;
  selectedCount: number;
}) {
  return (
    <div className="career-role-assessment-actions career-role-assessment-suggestion-actions">
      <button
        className="career-quiet-button"
        type="button"
        disabled={busy}
        onClick={() => onSetAll(true)}
      >
        Выбрать всё
      </button>
      <button className="career-quiet-button" type="button" disabled={busy} onClick={onAcceptAll}>
        Принять всё
      </button>
      <button
        className="career-quiet-button"
        type="button"
        disabled={busy}
        onClick={() => onSetAll(false)}
      >
        Снять выбор
      </button>
      <button className="career-quiet-button" type="button" disabled={busy} onClick={onSave}>
        Перейти без добавления
      </button>
      <button
        className="career-primary-button"
        type="button"
        disabled={busy || selectedCount === 0}
        onClick={onSave}
      >
        {busy ? 'Сохраняем…' : 'Принять выбранное и перейти к кейсам'}
      </button>
    </div>
  );
}
