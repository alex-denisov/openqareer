import { ArrowRight, Info } from '@phosphor-icons/react';
import { TariffQuotaNote } from '../tariffs/TariffQuotaNote';
import { formatInterviewMoment, presentInterviewLength, presentQuestionScopeCaption } from './interviewSimulatorPresentation';
import type { MockInterviewSimulatorProps } from './mockInterviewSimulatorTypes';
import { InlineError } from './MockInterviewSupport';
import { SourcePanel } from './MockInterviewSourcePanel';
import type { MockInterviewFlow } from './useMockInterviewController';
import { questionTypesForScope } from './useMockInterviewControllerActions';

type Flow = MockInterviewFlow;

export function SetupScreen({ flow, props }: { readonly flow: Flow; readonly props: MockInterviewSimulatorProps }) {
  const hasActiveSession = flow.session?.status === 'active' || flow.session?.status === 'paused';
  const hasResumableSession = flow.session && ['active', 'paused', 'interrupted'].includes(flow.session.status);
  const canStart = !hasActiveSession && flow.operation === null;
  return (
    <div className="career-mock-layout career-mock-setup-layout">
      <main className="career-mock-panel career-mock-setup-panel">
        <MobileHero props={props} />
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
          <button type="button" className="career-btn career-btn-secondary career-mock-later" onClick={props.onBackToPreparation}>
            Позже
          </button>
        </div>
        <TariffQuotaNote quota="interview_trainings" refreshKey={flow.session?.id} />
        {flow.error ? <InlineError error={flow.error.message} /> : null}
      </main>
      <SourcePanel
        vacancy={props.vacancy}
        stories={flow.starStories}
        storiesError={flow.starStoriesError}
        onOpenStories={() => props.onOpenStarStories(() => flow.retryLoad())}
      />
    </div>
  );
}

/** Заголовок старта на 390: компания и роль, длина тренировки, чип даты интервью. */
function MobileHero({ props }: { readonly props: MockInterviewSimulatorProps }) {
  const interviewAt = props.vacancy.interviewAt ? formatInterviewMoment(props.vacancy.interviewAt) : null;
  const target = [props.vacancy.company, props.vacancy.title].filter(Boolean).join(', ');
  return (
    <div className="career-mock-page-heading">
      <h2>Мок-интервью</h2>
      <p>{target} · {presentInterviewLength()}. Ответы сохраняются, можно вернуться.</p>
      {interviewAt ? <span className="career-mock-date-chip">Интервью {interviewAt}</span> : null}
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
          { value: 'text', label: 'Текстом', detail: 'Есть время подумать, ответ можно править' },
          { value: 'voice', label: 'Голосом', detail: 'Ближе к реальности. Речь распознаёт браузер, на сервер уходит только текст' },
        ]}
        onChange={(value) => flow.setMode(value as 'text' | 'voice')}
      />
      <RadioOptions
        legend="Какие вопросы"
        name="mock-question-scope"
        value={flow.questionScope}
        disabled={disabled}
        options={[
          { value: 'both', label: 'По вакансии и моим историям', detail: presentQuestionScopeCaption(questionTypesForScope('both')) },
          { value: 'behavioral', label: 'Только поведенческие', detail: `${presentQuestionScopeCaption(questionTypesForScope('behavioral'))}-историям` },
          { value: 'system_design', label: 'Только по требованиям', detail: presentQuestionScopeCaption(questionTypesForScope('system_design')) },
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
        <label htmlFor="career-mock-stress-mode">Стресс-режим: перебивания и жёсткие уточнения</label>
      </div>
    </section>
  );
}

function RadioOptions({ legend, name, value, disabled, options, onChange }: {
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
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
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
      <Info aria-hidden="true" className="career-mock-icon" />
      <p>Подсказки и таймера нет. Пропущенный вопрос не оценивается. Ответы и разбор хранятся в вашем профиле, их можно удалить.</p>
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
        <button type="button" className="career-btn career-btn-primary" disabled={flow.operation !== null} onClick={() => void flow.resume()}>
          <ArrowRight aria-hidden="true" className="career-mock-icon" />
          Продолжить с вопроса {currentNumber}
        </button>
        {session.status === 'active' || session.status === 'paused' ? (
          <button type="button" className="career-btn career-btn-secondary" disabled={flow.operation !== null} onClick={() => void flow.stop()}>
            Остановить тренировку
          </button>
        ) : null}
      </div>
    </section>
  );
}
