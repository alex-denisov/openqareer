import type { FormEvent } from 'react';
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleNotch,
  ListChecks,
  Microphone,
  PaperPlaneTilt,
  PencilSimple,
  Sparkle,
  StopCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import { useEscapeLayer } from '../shell/escapeLayers';
import type { InterviewQuestionView } from './interviewSimulatorApi';
import { useMockInterviewController } from './useMockInterviewController';
import type { MockInterviewSimulatorProps } from './mockInterviewSimulatorTypes';
import type { SpeechIssue } from './browserSpeechRecognition';
import type { SpeechTranscription } from './useSpeechTranscription';
import { formatElapsed, QuestionProgress } from './MockInterviewProgress';
import { ResultScreen } from './MockInterviewResultScreen';
import {
  ExitConfirmation,
  InlineError,
  InterruptedScreen,
  LoadErrorScreen,
  MissingQuestion,
  MockInterviewLoading,
  PaywallScreen,
  SessionError,
  SourcePanel,
} from './MockInterviewSupport';
import './mock-interview.css';
import './mock-interview-flow.css';

type Flow = ReturnType<typeof useMockInterviewController>;

export function MockInterviewSimulator(props: MockInterviewSimulatorProps) {
  const flow = useMockInterviewController(props.vacancy.title, props.onBackToPreparation);
  useEscapeLayer(flow.returnToPreparation, true);

  return (
    <div
      ref={props.dialogRef}
      className="career-mock-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="career-mock-title"
      tabIndex={-1}
      aria-busy={flow.loadState === 'loading' || flow.screen === 'preparing'}
    >
      <MockInterviewHeader screen={flow.screen} onBack={flow.returnToPreparation} onAskConsultant={props.onAskConsultant} />
      <div className="career-mock-content">
        <DesktopPageTitle />
        <MockInterviewSessionHeader vacancy={props.vacancy} flow={flow} onBack={flow.returnToPreparation} />
        <MockInterviewContent flow={flow} props={props} />
      </div>
      {flow.exitConfirmation ? (
        <ExitConfirmation
          onStay={() => flow.setExitConfirmation(false)}
          onLeave={flow.confirmReturnToPreparation}
        />
      ) : null}
    </div>
  );
}

function MockInterviewHeader({
  screen,
  onBack,
  onAskConsultant,
}: {
  readonly screen: Flow['screen'];
  readonly onBack: () => void;
  readonly onAskConsultant?: () => void;
}) {
  const titles: Record<Flow['screen'], string> = {
    setup: 'Мок-интервью',
    preparing: 'Вопрос',
    question: 'Вопрос',
    voice: 'Вопрос',
    review: 'Разбор',
    interrupted: 'Пауза',
    result: 'Итог',
    paywall: 'Доступ',
  };
  return (
    <header className="career-mock-header">
      <button
        type="button"
        className="career-mock-icon-button"
        aria-label="Назад к подготовке"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" className="career-mock-icon" />
      </button>
      <h1 id="career-mock-title">{titles[screen]}</h1>
      {onAskConsultant ? (
        <button
          type="button"
          className="career-mock-icon-button"
          aria-label="Спросить консультанта"
          onClick={onAskConsultant}
        >
          <Sparkle aria-hidden="true" className="career-mock-icon" />
        </button>
      ) : <span className="career-mock-header-spacer" aria-hidden="true" />}
    </header>
  );
}

function DesktopPageTitle() {
  return <h1 className="career-mock-desktop-title">Мок-интервью</h1>;
}

function MockInterviewSessionHeader({ vacancy, flow, onBack }: {
  readonly vacancy: MockInterviewSimulatorProps['vacancy'];
  readonly flow: Flow;
  readonly onBack: () => void;
}) {
  const session = flow.session;
  const stateLabel = session?.status === 'completed'
    ? 'Завершено'
    : session?.status === 'interrupted'
      ? 'Прервано'
      : session?.status === 'paused'
        ? 'На паузе'
        : session ? 'Прогресс сохраняется' : 'Новая тренировка';
  const summary = !session
    ? 'Настройте режим ответа, тип вопросов и стресс-режим перед началом.'
    : session.status === 'completed'
      ? 'Ответы и разбор сохранены.'
      : session.status === 'interrupted' || session.status === 'paused'
        ? 'Сохранённую тренировку можно продолжить.'
        : 'Ответы сохраняются после оценки.';
  return (
    <section className="career-mock-session-header" aria-label="Текущая тренировка">
      <button type="button" className="career-mock-icon-button" aria-label="Назад к подготовке" onClick={onBack}>
        <ArrowLeft aria-hidden="true" className="career-mock-icon" />
      </button>
      <div className="career-mock-session-heading">
        <h2>Мок-интервью: {vacancy.company ? `${vacancy.company}, ` : ''}{vacancy.title}</h2>
        <p>{summary}</p>
      </div>
      <span className="career-mock-session-status">{stateLabel}</span>
    </section>
  );
}

function MockInterviewContent({ flow, props }: { readonly flow: Flow; readonly props: MockInterviewSimulatorProps }) {
  if (flow.loadState === 'loading') return <MockInterviewLoading label="Загружаем сохранённую тренировку" />;
  if (flow.loadState === 'error') return <LoadErrorScreen flow={flow} />;
  if (flow.screen === 'preparing') return <MockInterviewLoading label="Вопрос готовится" />;
  if (flow.screen === 'paywall') return <PaywallScreen onBack={props.onBackToPreparation} />;
  if (flow.screen === 'question') return <QuestionScreen flow={flow} props={props} />;
  if (flow.screen === 'voice') return <VoiceScreen flow={flow} props={props} />;
  if (flow.screen === 'review') return <ReviewScreen flow={flow} props={props} />;
  if (flow.screen === 'interrupted') return <InterruptedScreen flow={flow} props={props} />;
  if (flow.screen === 'result' && flow.session) return <ResultScreen flow={flow} props={props} />;
  return <SetupScreen flow={flow} props={props} />;
}

function SetupScreen({ flow, props }: { readonly flow: Flow; readonly props: MockInterviewSimulatorProps }) {
  const hasActiveSession = flow.session?.status === 'active' || flow.session?.status === 'paused';
  const hasResumableSession = flow.session && ['active', 'paused', 'interrupted'].includes(flow.session.status);
  const canStart = !hasActiveSession && flow.operation === null;
  return (
    <div className="career-mock-layout career-mock-setup-layout">
      <main className="career-mock-panel career-mock-setup-panel">
        <div className="career-mock-page-heading">
          <h2>Мок-интервью</h2>
          <p>{props.vacancy.company ? `${props.vacancy.company} · ` : ''}{props.vacancy.title}</p>
          <p>Настройте тренировку. Ответы и разбор будут сохранены в вашем профиле.</p>
        </div>
        <h2 className="career-mock-section-title">Как будем тренироваться</h2>
        {hasResumableSession ? <CurrentSessionCard flow={flow} /> : null}
        <TrainingOptions flow={flow} disabled={!canStart} />
        <HowToAnswer />
        <div className="career-mock-action-row">
          <button
            type="button"
            className="career-btn career-btn-primary career-mock-primary"
            disabled={!canStart || flow.loadState !== 'ready'}
            onClick={() => void flow.start()}
          >
            <ArrowRight aria-hidden="true" className="career-mock-icon" />
            Начать
          </button>
          <button type="button" className="career-btn career-btn-ghost" onClick={props.onBackToPreparation}>
            Позже
          </button>
        </div>
        {flow.error ? <InlineError error={flow.error.message} /> : null}
      </main>
      <SourcePanel
        vacancy={props.vacancy}
        stories={flow.starStories}
        storiesError={flow.starStoriesError}
        loading={false}
        onOpenStories={() => props.onOpenStarStories(() => flow.retryLoad())}
      />
    </div>
  );
}

function TrainingOptions({ flow, disabled }: { readonly flow: Flow; readonly disabled: boolean }) {
  return (
    <section className="career-mock-options" aria-label="Параметры тренировки">
      <RadioOptions
        legend="Как отвечать"
        name="mock-answer-mode"
        value={flow.mode}
        disabled={disabled}
        options={[
          { value: 'text', label: 'Текстом', detail: 'Можно подумать и отредактировать до отправки' },
          { value: 'voice', label: 'Голосом', detail: 'Браузер распознаёт речь, на сервер уходит текст' },
        ]}
        onChange={(value) => flow.setMode(value as 'text' | 'voice')}
      />
      <RadioOptions
        legend="Какие вопросы"
        name="mock-question-scope"
        value={flow.questionScope}
        disabled={disabled}
        options={[
          { value: 'both', label: 'По вакансии и моим историям' },
          { value: 'behavioral', label: 'Только поведенческие' },
          { value: 'system_design', label: 'Только по требованиям' },
        ]}
        onChange={(value) => flow.setQuestionScope(value as typeof flow.questionScope)}
      />
      <div className="career-mock-stress-option">
        <input
          id="career-mock-stress-mode"
          type="checkbox"
          checked={flow.stressMode}
          disabled={disabled}
          onChange={(event) => flow.setStressMode(event.currentTarget.checked)}
        />
        <label htmlFor="career-mock-stress-mode">
          <strong>Стресс-режим</strong>
          <span>Перебивания и жёсткие уточнения</span>
        </label>
      </div>
    </section>
  );
}

function RadioOptions({
  legend,
  name,
  value,
  disabled,
  options,
  onChange,
}: {
  readonly legend: string;
  readonly name: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly options: readonly { readonly value: string; readonly label: string; readonly detail?: string }[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <fieldset className="career-mock-radio-group" disabled={disabled}>
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="career-mock-radio-option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <strong>{option.label}</strong>
            {option.detail ? <span>{option.detail}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function HowToAnswer() {
  return (
    <aside className="career-mock-help" role="note">
      <ListChecks aria-hidden="true" className="career-mock-icon" />
      <p>Ответ можно пропустить или остановить. Пропущенный вопрос не оценивается. Перед отправкой текст можно исправить.</p>
    </aside>
  );
}

function CurrentSessionCard({ flow }: { readonly flow: Flow }) {
  const session = flow.session;
  if (!session) return null;
  const currentNumber = Math.min(session.currentQuestionIndex + 1, session.questions.length);
  return (
    <section className="career-mock-current-session" aria-labelledby="career-mock-resume-title">
      <h3 id="career-mock-resume-title">Есть сохранённая тренировка</h3>
      <p>{session.roleTitle}. Вопрос {currentNumber} из {session.questions.length}.</p>
      <div className="career-mock-action-row">
        <button
          type="button"
          className="career-btn career-btn-primary"
          disabled={flow.operation !== null}
          onClick={() => void flow.resume()}
        >
          <ArrowRight aria-hidden="true" className="career-mock-icon" />
          Продолжить с вопроса {currentNumber}
        </button>
        {session.status === 'active' || session.status === 'paused' ? (
          <button
            type="button"
            className="career-btn career-btn-secondary"
            disabled={flow.operation !== null}
            onClick={() => void flow.stop()}
          >
            Остановить тренировку
          </button>
        ) : null}
      </div>
    </section>
  );
}


function QuestionScreen({ flow, props }: { readonly flow: Flow; readonly props: MockInterviewSimulatorProps }) {
  const question = flow.currentQuestion;
  if (!flow.session || !question) return <MissingQuestion onRetry={flow.retryLoad} />;
  return (
    <div className="career-mock-layout career-mock-question-layout">
      <main className="career-mock-panel career-mock-question-panel">
        <QuestionProgress session={flow.session} modeLabel={flow.mode === 'voice' ? 'Голосовой ответ' : 'Текстовый ответ'} />
        <div className="career-mock-question-toolbar">
          <button type="button" className="career-btn career-btn-ghost" onClick={() => void flow.skip()}>
            Пропустить вопрос
          </button>
          <button type="button" className="career-btn career-btn-ghost" onClick={() => void flow.stop()}>
            <StopCircle aria-hidden="true" className="career-mock-icon" />
            Остановиться
          </button>
        </div>
        <p className="career-mock-question-prompt">{question.prompt}</p>
        {flow.error ? <SessionError flow={flow} onRetryAnswer={() => void flow.submitAnswer(flow.draft, flow.answerElapsedSeconds())} /> : null}
        <AnswerComposer
          draft={flow.draft}
          disabled={flow.operation !== null}
          onChange={flow.setDraft}
          onSubmit={() => void flow.submitAnswer(flow.draft, flow.answerElapsedSeconds())}
          onVoice={flow.startVoice}
        />
      </main>
      <SourcePanel
        session={flow.session}
        question={question}
        stories={flow.starStories}
        storiesError={flow.starStoriesError}
        onOpenStories={() => props.onOpenStarStories(() => flow.retryLoad())}
      />
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
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <div className="career-mock-composer">
      <form onSubmit={submit}>
      <label className="career-mock-sr-only" htmlFor="career-mock-answer">Ваш ответ</label>
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
        <AnswerComposerActions draft={draft} disabled={disabled} onVoice={onVoice} />
      </form>
    </div>
  );
}

function AnswerComposerActions({
  draft,
  disabled,
  onVoice,
}: {
  readonly draft: string;
  readonly disabled: boolean;
  readonly onVoice: () => void;
}) {
  return (
    <div className="career-mock-composer-actions">
      <button type="button" className="career-btn career-btn-secondary" disabled={disabled} onClick={onVoice}>
        <Microphone aria-hidden="true" className="career-mock-icon" />
        Ответить голосом
      </button>
      <button type="submit" className="career-btn career-btn-primary career-mock-send" aria-label="Отправить ответ" disabled={disabled || !draft.trim()} aria-busy={disabled}>
        {disabled ? <CircleNotch aria-hidden="true" className="career-mock-icon is-spinning" /> : <PaperPlaneTilt aria-hidden="true" className="career-mock-icon" />}
        <span>{disabled ? 'Оцениваем' : 'Отправить'}</span>
      </button>
    </div>
  );
}

function VoiceScreen({ flow, props }: { readonly flow: Flow; readonly props: MockInterviewSimulatorProps }) {
  const question = flow.currentQuestion;
  if (!flow.session || !question) return <MissingQuestion onRetry={flow.retryLoad} />;
  const voice = flow.speech;
  return (
    <div className="career-mock-layout career-mock-voice-layout">
      <main className="career-mock-panel career-mock-question-panel">
        <QuestionProgress session={flow.session} modeLabel="Голосовой ответ" />
        <div className="career-mock-question-toolbar">
          <button type="button" className="career-btn career-btn-ghost" onClick={() => void flow.skip()}>
            Пропустить вопрос
          </button>
          <button type="button" className="career-btn career-btn-ghost" onClick={() => void flow.stop()}>
            <StopCircle aria-hidden="true" className="career-mock-icon" />
            Остановиться
          </button>
        </div>
        <p className="career-mock-question-prompt">{question.prompt}</p>
        <VoiceTranscript voice={voice} />
        {voice.issue ? <SpeechIssueNotice issue={voice.issue} /> : null}
        {flow.error ? (
          <SessionError
            flow={flow}
            onRetryAnswer={() => void flow.submitAnswer(voice.transcript, voice.elapsedSeconds)}
          />
        ) : null}
        <VoiceActions
          voice={voice}
          busy={flow.operation !== null}
          onFinish={() => void flow.submitAnswer(voice.transcript, voice.elapsedSeconds)}
          onRestart={() => flow.startVoice()}
          onText={flow.switchToText}
        />
      </main>
      <SourcePanel
        session={flow.session}
        question={question}
        stories={flow.starStories}
        storiesError={flow.starStoriesError}
        onOpenStories={() => props.onOpenStarStories(() => flow.retryLoad())}
      />
    </div>
  );
}

function VoiceTranscript({ voice }: { readonly voice: SpeechTranscription }) {
  const status = voice.state === 'recording'
    ? `Идёт запись, ${formatElapsed(voice.elapsedSeconds)}`
    : voice.transcript.trim() ? 'Распознано' : 'Запись не начата';
  const placeholder = voice.state === 'recording'
    ? 'Говорите. Распознанный текст появится здесь.'
    : 'Нажмите «Начать запись», чтобы ответить голосом.';
  return (
    <section className="career-mock-transcript" aria-label="Распознанный текст ответа">
      <p className="career-mock-transcript-label" role="status">{status}</p>
      <p aria-live="polite">{voice.transcript || placeholder}</p>
    </section>
  );
}

function SpeechIssueNotice({ issue }: { readonly issue: SpeechIssue }) {
  const message = issue === 'permission'
    ? 'Микрофон недоступен. Разрешите доступ в браузере или ответьте текстом.'
    : issue === 'unrecognized'
      ? 'Речь не распознана. Запишите ответ ещё раз или напишите его.'
      : 'Распознавание речи недоступно в этом браузере. Можно ответить текстом.';
  return (
    <div className="career-mock-inline-note" role="status">
      <WarningCircle aria-hidden="true" className="career-mock-icon" />
      <span>{message}</span>
      {issue === 'permission' ? (
        <details>
          <summary>Как разрешить</summary>
          <p>Откройте настройки разрешений сайта в браузере и включите микрофон. Если доступ недоступен, выберите текстовый ответ.</p>
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
      <button type="button" className="career-btn career-btn-primary" disabled={busy || !voice.transcript.trim()} onClick={onFinish}>
        <Check aria-hidden="true" className="career-mock-icon" />
        Закончить ответ
      </button>
      {voice.state === 'recording' ? (
        <button type="button" className="career-btn career-btn-secondary" onClick={voice.stop}>
          Остановить запись
        </button>
      ) : (
        <button type="button" className="career-btn career-btn-secondary" onClick={onRestart}>
          <ArrowClockwise aria-hidden="true" className="career-mock-icon" />
        {voice.transcript.trim() ? 'Записать снова' : 'Начать запись'}
        </button>
      )}
      <button type="button" className="career-btn career-btn-ghost" onClick={onText}>
        Ответить текстом
      </button>
    </div>
  );
}

function ReviewScreen({ flow, props }: { readonly flow: Flow; readonly props: MockInterviewSimulatorProps }) {
  const session = flow.session;
  const question = flow.currentQuestion;
  const answer = question?.answer;
  if (!session || !question || !answer) return <MissingQuestion onRetry={flow.retryLoad} />;
  return (
    <div className="career-mock-layout career-mock-review-layout">
      <main className="career-mock-panel career-mock-review-panel">
        <QuestionProgress session={session} modeLabel="Разбор ответа" />
        <h2>Разбор ответа</h2>
        <section className="career-mock-answer-quote" aria-labelledby="career-mock-answer-title">
          <h3 id="career-mock-answer-title">Ваш ответ</h3>
          <p>{answer.text}</p>
        </section>
        <CriteriaList questionType={question.type} evaluation={answer.evaluation} />
        {answer.evaluation.feedback ? <ModelFeedback message={answer.evaluation.feedback} /> : null}
        {flow.error ? <SessionError flow={flow} /> : null}
        <ReviewActions
          question={question}
          disabled={flow.operation !== null}
          onNext={() => void flow.next()}
          onTryAgain={flow.tryAgain}
        onEditStory={() => props.onOpenStarStories(() => flow.retryLoad())}
        />
      </main>
      <SourcePanel
        session={session}
        question={question}
        stories={flow.starStories}
        storiesError={flow.starStoriesError}
        onOpenStories={() => props.onOpenStarStories(() => flow.retryLoad())}
      />
    </div>
  );
}

function CriteriaList({
  questionType,
  evaluation,
}: {
  readonly questionType: InterviewQuestionView['type'];
  readonly evaluation: NonNullable<InterviewQuestionView['answer']>['evaluation'];
}) {
  const labels = questionType === 'behavioral'
    ? { situation: 'Ситуация', task: 'Задача', action: 'Ваши действия', result: 'Результат' }
    : { requirements: 'Требования', architecture: 'Архитектура', tradeoffs: 'Компромиссы', operations: 'Эксплуатация' };
  return (
    <section className="career-mock-criteria" aria-labelledby="career-mock-criteria-title">
      <h3 id="career-mock-criteria-title">Критерии</h3>
      <ul>
        {Object.entries(evaluation.criteria).map(([key, criterion]) => (
          <li key={key}>
            <div className="career-mock-criterion-title">
              <strong>{labels[key as keyof typeof labels] ?? key}</strong>
              <CriterionStatus points={criterion.points} />
            </div>
            <p>{criterion.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CriterionStatus({ points }: { readonly points: 0 | 1 | 2 }) {
  const status = points === 2 ? 'Есть' : points === 1 ? 'Частично' : 'Нет';
  return <span className={`career-mock-status career-mock-status--${points}`}>{status}</span>;
}

function ModelFeedback({ message }: { readonly message: string }) {
  return (
    <aside className="career-mock-feedback" aria-label="Комментарий модели">
      <Sparkle aria-hidden="true" className="career-mock-icon" />
      <p>{message}</p>
    </aside>
  );
}

function ReviewActions({
  question,
  disabled,
  onNext,
  onTryAgain,
  onEditStory,
}: {
  readonly question: InterviewQuestionView;
  readonly disabled: boolean;
  readonly onNext: () => void;
  readonly onTryAgain: () => void;
  readonly onEditStory: () => void;
}) {
  return (
    <div className="career-mock-review-actions">
      <button type="button" className="career-btn career-btn-primary" disabled={disabled} onClick={onNext}>
        <ArrowRight aria-hidden="true" className="career-mock-icon" />
        Следующий вопрос
      </button>
      <div className="career-mock-action-row">
        <button type="button" className="career-btn career-btn-secondary" disabled={disabled} onClick={onTryAgain}>
          <ArrowClockwise aria-hidden="true" className="career-mock-icon" />
          Ответить ещё раз
        </button>
        {question.storyId ? (
          <button type="button" className="career-btn career-btn-ghost" onClick={onEditStory}>
            <PencilSimple aria-hidden="true" className="career-mock-icon" />
            Править STAR-историю
          </button>
        ) : null}
      </div>
    </div>
  );
}
