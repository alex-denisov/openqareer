import type { FormEvent } from 'react';
import {
  ArrowClockwise,
  ArrowRight,
  Check,
  CheckCircle,
  Circle,
  CircleNotch,
  Lightbulb,
  Microphone,
  PaperPlaneTilt,
  PencilSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import { InterviewDiaryAction } from './InterviewDiaryAction';
import type { SpeechIssue } from './browserSpeechRecognition';
import type { InterviewQuestionView } from './interviewSimulatorApi';
import type { MockInterviewSimulatorProps } from './mockInterviewSimulatorTypes';
import { formatElapsed, QuestionProgress } from './MockInterviewProgress';
import { SourcePanel } from './MockInterviewSourcePanel';
import { MissingQuestion, SessionError } from './MockInterviewSupport';
import './mock-interview-dock.css';
import type { MockInterviewFlow } from './useMockInterviewController';
import type { SpeechTranscription } from './useSpeechTranscription';

type Flow = MockInterviewFlow;

interface ScreenProps {
  readonly flow: Flow;
  readonly props: MockInterviewSimulatorProps;
}

function QuestionSourcePanel({ flow, props }: ScreenProps) {
  return (
    <SourcePanel
      vacancy={props.vacancy}
      question={flow.currentQuestion}
      stories={flow.starStories}
      storiesError={flow.starStoriesError}
      onOpenStories={() => props.onOpenStarStories(() => flow.retryLoad())}
    />
  );
}

export function QuestionScreen({ flow, props }: ScreenProps) {
  const question = flow.currentQuestion;
  if (!flow.session || !question) return <MissingQuestion onRetry={flow.retryLoad} />;
  const busy = flow.operation !== null;
  const submit = () => void flow.submitAnswer(flow.draft, flow.answerElapsedSeconds());
  return (
    <div className="career-mock-layout career-mock-question-layout">
      <main className="career-mock-panel career-mock-question-panel">
        <QuestionProgress session={flow.session} title="Вопрос" />
        <QuestionDockActions flow={flow} busy={busy} />
        <p className="career-mock-question-prompt">{question.prompt}</p>
        {flow.error ? <SessionError flow={flow} onRetryAnswer={submit} /> : null}
        <AnswerComposer
          draft={flow.draft}
          disabled={busy}
          onChange={flow.setDraft}
          onSubmit={submit}
          onVoice={flow.startVoice}
        />
        <QuestionActions flow={flow} busy={busy} />
      </main>
      <QuestionSourcePanel flow={flow} props={props} />
    </div>
  );
}

/** 390, макет 14: «Остановиться» и «Пропустить» чипами над вопросом. */
function QuestionDockActions({ flow, busy }: { readonly flow: Flow; readonly busy: boolean }) {
  return (
    <div className="career-mock-dock-acts" role="group" aria-label="Действия с вопросом">
      <button
        type="button"
        className="career-mock-dock-chip"
        disabled={busy}
        onClick={() => void flow.stop()}
      >
        Остановиться
      </button>
      <button
        type="button"
        className="career-mock-dock-chip"
        disabled={busy}
        onClick={() => void flow.skip()}
      >
        Пропустить
      </button>
    </div>
  );
}

function QuestionActions({ flow, busy }: { readonly flow: Flow; readonly busy: boolean }) {
  return (
    <div className="career-mock-action-row career-mock-question-actions">
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        disabled={busy}
        onClick={flow.startVoice}
      >
        <Microphone aria-hidden="true" className="career-mock-icon" />
        Ответить голосом
      </button>
      <button
        type="button"
        className="career-btn career-btn-ghost career-btn-sm"
        disabled={busy}
        onClick={() => void flow.skip()}
      >
        Пропустить вопрос
      </button>
      <button
        type="button"
        className="career-btn career-btn-ghost career-btn-sm"
        disabled={busy}
        onClick={() => void flow.stop()}
      >
        Остановиться
      </button>
    </div>
  );
}

function AnswerComposer({
  draft,
  disabled,
  onChange,
  onSubmit,
  onVoice,
}: {
  readonly draft: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onVoice: () => void;
}) {
  const empty = !draft.trim();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="career-mock-composer" onSubmit={submit}>
      <label className="career-mock-sr-only" htmlFor="career-mock-answer">
        Ваш ответ
      </label>
      <textarea
        id="career-mock-answer"
        value={draft}
        maxLength={4_000}
        disabled={disabled}
        placeholder="Ответьте своими словами"
        aria-describedby="career-mock-answer-help"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <p id="career-mock-answer-help" className="career-mock-sr-only">
        Текст будет отправлен на оценку после нажатия кнопки.
      </p>
      <ComposerButtons empty={empty} disabled={disabled} onVoice={onVoice} />
    </form>
  );
}

/** Пустое поле — микрофон (390), иначе отправка; пока ответ оценивается — индикатор. */
function ComposerButtons({
  empty,
  disabled,
  onVoice,
}: {
  readonly empty: boolean;
  readonly disabled: boolean;
  readonly onVoice: () => void;
}) {
  return (
    <>
      {empty && !disabled ? (
        // 390, макет 14: пока поле пустое, в доке вместо отправки — голосовой ввод.
        <button
          type="button"
          className="career-mock-dock-mic"
          aria-label="Голосовой ввод"
          onClick={onVoice}
        >
          <Microphone aria-hidden="true" className="career-mock-icon" />
        </button>
      ) : null}
      <button
        type="submit"
        className={`career-mock-send${empty && !disabled ? ' is-empty' : ''}`}
        aria-label={disabled ? 'Оцениваем ответ' : 'Отправить ответ'}
        disabled={disabled || empty}
        aria-busy={disabled}
      >
        {disabled ? (
          <CircleNotch aria-hidden="true" className="career-mock-icon is-spinning" />
        ) : (
          <PaperPlaneTilt aria-hidden="true" className="career-mock-icon" />
        )}
      </button>
    </>
  );
}

export function VoiceScreen({ flow, props }: ScreenProps) {
  const question = flow.currentQuestion;
  if (!flow.session || !question) return <MissingQuestion onRetry={flow.retryLoad} />;
  const voice = flow.speech;
  const finish = () => void flow.submitAnswer(voice.transcript, voice.elapsedSeconds);
  return (
    <div className="career-mock-layout career-mock-voice-layout">
      <main className="career-mock-panel career-mock-question-panel">
        <QuestionProgress session={flow.session} title="Запись ответа" />
        <p className="career-mock-question-prompt">{question.prompt}</p>
        <RecordingStatus voice={voice} />
        <VoiceTranscript voice={voice} />
        {voice.issue ? <SpeechIssueNotice issue={voice.issue} /> : null}
        {flow.error ? <SessionError flow={flow} onRetryAnswer={finish} /> : null}
        <VoiceActions
          voice={voice}
          busy={flow.operation !== null}
          onFinish={finish}
          onRestart={flow.startVoice}
          onText={flow.switchToText}
        />
      </main>
      <QuestionSourcePanel flow={flow} props={props} />
    </div>
  );
}

function RecordingStatus({ voice }: { readonly voice: SpeechTranscription }) {
  const recording = voice.state === 'recording';
  return (
    <div className={`career-mock-recording${recording ? ' is-recording' : ''}`} role="status">
      <span className="career-mock-recording-dot" aria-hidden="true" />
      <strong>{recording ? 'Идёт запись' : 'Запись остановлена'}</strong>
      <span>{formatElapsed(voice.elapsedSeconds)}</span>
    </div>
  );
}

function VoiceTranscript({ voice }: { readonly voice: SpeechTranscription }) {
  const placeholder =
    voice.state === 'recording'
      ? 'Говорите. Распознанный текст появится здесь.'
      : 'Нажмите «Начать запись», чтобы ответить голосом.';
  return (
    <section className="career-mock-transcript" aria-label="Распознанный текст ответа">
      <p className="career-mock-transcript-label">Распознано сейчас</p>
      <p aria-live="polite">{voice.transcript || placeholder}</p>
    </section>
  );
}

function SpeechIssueNotice({ issue }: { readonly issue: SpeechIssue }) {
  const message =
    issue === 'permission'
      ? 'Микрофон недоступен: разрешение не выдано. Можно ответить текстом, прогресс сохранён.'
      : issue === 'unrecognized'
        ? 'Речь не распознана: звук не сохранён. Повторите ответ или напишите его.'
        : 'Распознавание речи недоступно в этом браузере. Можно ответить текстом, прогресс сохранён.';
  return (
    <div
      className={`career-mock-inline-note${issue === 'unrecognized' ? '' : ' is-error'}`}
      role="status"
    >
      <WarningCircle aria-hidden="true" className="career-mock-icon" />
      <span>{message}</span>
      {issue === 'permission' ? (
        <details>
          <summary>Как разрешить</summary>
          <p>
            Откройте настройки разрешений сайта в браузере и включите микрофон. Если доступ
            недоступен, выберите текстовый ответ.
          </p>
        </details>
      ) : null}
    </div>
  );
}

function VoiceActions({
  voice,
  busy,
  onFinish,
  onRestart,
  onText,
}: {
  readonly voice: SpeechTranscription;
  readonly busy: boolean;
  readonly onFinish: () => void;
  readonly onRestart: () => void;
  readonly onText: () => void;
}) {
  return (
    <div className="career-mock-action-row career-mock-voice-actions">
      <button
        type="button"
        className="career-btn career-btn-primary"
        disabled={busy || !voice.transcript.trim()}
        onClick={onFinish}
      >
        <Check aria-hidden="true" className="career-mock-icon" />
        Закончить ответ
      </button>
      {voice.state === 'recording' ? (
        <button type="button" className="career-btn career-btn-ghost" onClick={voice.stop}>
          Остановить запись
        </button>
      ) : (
        <button type="button" className="career-btn career-btn-ghost" onClick={onRestart}>
          <ArrowClockwise aria-hidden="true" className="career-mock-icon" />
          {voice.transcript.trim() ? 'Начать заново' : 'Начать запись'}
        </button>
      )}
      <button type="button" className="career-btn career-btn-ghost" onClick={onText}>
        <PencilSimple aria-hidden="true" className="career-mock-icon" />
        Ответить текстом
      </button>
    </div>
  );
}

export function ReviewScreen({ flow, props }: ScreenProps) {
  const session = flow.session;
  const question = flow.currentQuestion;
  const answer = question?.answer;
  if (!session || !question || !answer) return <MissingQuestion onRetry={flow.retryLoad} />;
  return (
    <div className="career-mock-layout career-mock-review-layout">
      <main className="career-mock-panel career-mock-review-panel">
        <QuestionProgress session={session} title="Разбор ответа" />
        <section className="career-mock-answer-quote" aria-labelledby="career-mock-answer-title">
          <h3 id="career-mock-answer-title">Ваш ответ, фрагмент</h3>
          <p>«{answer.text}»</p>
        </section>
        <CriteriaList questionType={question.type} evaluation={answer.evaluation} />
        <InterviewDiaryAction key={`${session.id}:${session.version}`} sessionId={session.id} />
        {answer.evaluation.feedback ? <ModelFeedback message={answer.evaluation.feedback} /> : null}
        {flow.error ? <SessionError flow={flow} /> : null}
        <ReviewActions flow={flow} props={props} storyId={question.storyId} />
      </main>
      <QuestionSourcePanel flow={flow} props={props} />
    </div>
  );
}

function ReviewActions({
  flow,
  props,
  storyId,
}: ScreenProps & { readonly storyId: string | null }) {
  return (
    <div className="career-mock-action-row career-mock-review-actions">
      <button
        type="button"
        className="career-btn career-btn-primary"
        disabled={flow.operation !== null}
        onClick={() => void flow.next()}
      >
        <ArrowRight aria-hidden="true" className="career-mock-icon" />
        Следующий вопрос
      </button>
      <button
        type="button"
        className="career-btn career-btn-secondary"
        disabled={flow.operation !== null}
        onClick={flow.tryAgain}
      >
        <ArrowClockwise aria-hidden="true" className="career-mock-icon" />
        Ответить ещё раз
      </button>
      {storyId ? (
        <button
          type="button"
          className="career-btn career-btn-ghost"
          onClick={() => props.onOpenStarStories(() => flow.retryLoad())}
        >
          <PencilSimple aria-hidden="true" className="career-mock-icon" />
          Править STAR-историю
        </button>
      ) : null}
    </div>
  );
}

const CRITERIA_LABELS: Readonly<
  Record<InterviewQuestionView['type'], Readonly<Record<string, string>>>
> = {
  behavioral: {
    situation: 'Ситуация названа',
    task: 'Задача названа',
    action: 'Ваши действия',
    result: 'Результат в цифрах',
  },
  system_design: {
    requirements: 'Требования',
    architecture: 'Архитектура',
    tradeoffs: 'Компромиссы',
    operations: 'Эксплуатация',
  },
};

function CriteriaList({
  questionType,
  evaluation,
}: {
  readonly questionType: InterviewQuestionView['type'];
  readonly evaluation: NonNullable<InterviewQuestionView['answer']>['evaluation'];
}) {
  const labels = CRITERIA_LABELS[questionType];
  return (
    <ul className="career-mock-criteria" aria-label="Критерии">
      {Object.entries(evaluation.criteria).map(([key, criterion]) => (
        <li key={key}>
          <CriterionIcon points={criterion.points} />
          <div>
            <div className="career-mock-criterion-title">
              <strong>{labels[key] ?? key}</strong>
              <CriterionStatus points={criterion.points} />
            </div>
            <p>{criterion.reason}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CriterionIcon({ points }: { readonly points: 0 | 1 | 2 }) {
  if (points === 2)
    return <CheckCircle aria-hidden="true" className="career-mock-criterion-icon is-yes" />;
  if (points === 1)
    return <WarningCircle aria-hidden="true" className="career-mock-criterion-icon is-partial" />;
  return <Circle aria-hidden="true" className="career-mock-criterion-icon is-no" />;
}

export function CriterionStatus({ points }: { readonly points: 0 | 1 | 2 }) {
  const status = points === 2 ? 'Есть' : points === 1 ? 'Частично' : 'Нет';
  return <span className={`career-mock-status career-mock-status--${points}`}>{status}</span>;
}

function ModelFeedback({ message }: { readonly message: string }) {
  return (
    <aside className="career-mock-feedback" aria-label="Как усилить">
      <Lightbulb aria-hidden="true" className="career-mock-icon" />
      <p>{message}</p>
    </aside>
  );
}
