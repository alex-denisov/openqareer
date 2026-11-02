import { useEffect, useRef } from 'react';
import {
  ArrowRight,
  CircleNotch,
  StopCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import type { InterviewSessionView } from './interviewSimulatorApi';
import type { StarStoriesSnapshot } from '../../../shared/starStories';
import { TariffQuotaNote } from '../tariffs/TariffQuotaNote';
import type { MockInterviewScreen } from './mockInterviewControllerTypes';
import type { MockInterviewVacancy } from './mockInterviewSimulatorTypes';
import { SourcePanel } from './MockInterviewSourcePanel';

interface SupportFlow {
  readonly loadError: { readonly message: string } | null;
  readonly retryLoad: () => void;
  readonly session: InterviewSessionView | null;
  readonly operation: 'start' | 'answer' | 'transition' | null;
  readonly error: { readonly message: string } | null;
  readonly failedOperation: 'start' | 'answer' | 'transition' | null;
  readonly refreshSession: () => void;
  readonly resume: () => Promise<unknown>;
  readonly setScreen: (screen: MockInterviewScreen) => void;
  readonly starStories: StarStoriesSnapshot | null;
  readonly starStoriesError: string | null;
}

interface SupportSimulatorProps {
  readonly vacancy: MockInterviewVacancy;
  readonly onOpenStarStories: (afterClose?: () => void) => void;
}

export function PaywallScreen({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="career-mock-state-screen">
      <div className="career-mock-state-card">
        <WarningCircle aria-hidden="true" className="career-mock-state-icon" />
        <h2>Мок-интервью недоступно на текущем тарифе</h2>
        <p>Тренировка не началась. Вернитесь к подготовке, чтобы выбрать другой следующий шаг.</p>
        <TariffQuotaNote quota="interview_trainings" />
        <button type="button" className="career-btn career-btn-primary" onClick={onBack}>К подготовке</button>
      </div>
    </div>
  );
}

export function MockInterviewLoading({ label }: { readonly label: string }) {
  return (
    <div className="career-mock-state-screen" aria-busy="true">
      <div className="career-mock-loading-card" role="status">
        <CircleNotch aria-hidden="true" className="career-mock-icon is-spinning" />
        <span>{label}</span>
        <div className="career-mock-skeleton" aria-hidden="true" />
      </div>
    </div>
  );
}

export function LoadErrorScreen({ flow }: { readonly flow: SupportFlow }) {
  return (
    <div className="career-mock-state-screen">
      <div className="career-mock-state-card" role="alert">
        <WarningCircle aria-hidden="true" className="career-mock-state-icon" />
        <h2>Сохранённую тренировку не удалось загрузить</h2>
        <p>{flow.loadError?.message ?? 'Проверьте соединение и повторите запрос.'}</p>
        <button type="button" className="career-btn career-btn-primary" onClick={flow.retryLoad}>Повторить</button>
      </div>
    </div>
  );
}

export function MissingQuestion({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="career-mock-state-screen">
      <div className="career-mock-state-card" role="alert">
        <WarningCircle aria-hidden="true" className="career-mock-state-icon" />
        <h2>Текущий вопрос недоступен</h2>
        <p>Обновите сохранённую тренировку, чтобы увидеть её текущее состояние.</p>
        <button type="button" className="career-btn career-btn-primary" onClick={onRetry}>Обновить</button>
      </div>
    </div>
  );
}

export function InlineError({ error }: { readonly error: string }) {
  return (
    <div className="career-mock-inline-error" role="alert">
      <WarningCircle aria-hidden="true" className="career-mock-icon" />
      <span>{error}</span>
    </div>
  );
}

export function SessionError({
  flow,
  onRetryAnswer,
}: {
  readonly flow: SupportFlow;
  readonly onRetryAnswer?: () => void;
}) {
  const retryAnswer = flow.failedOperation === 'answer' && onRetryAnswer;
  return (
    <div className="career-mock-operation-error">
      <InlineError error={flow.error?.message ?? 'Тренировку не удалось обновить.'} />
      <button type="button" className="career-btn career-btn-secondary" onClick={retryAnswer ? onRetryAnswer : flow.refreshSession}>
        {retryAnswer ? 'Повторить оценку' : 'Обновить тренировку'}
      </button>
    </div>
  );
}

export function ExitConfirmation({ onStay, onLeave }: { readonly onStay: () => void; readonly onLeave: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => dialogRef.current?.focus(), []);
  return (
    <div className="career-mock-exit-layer">
      <section
        ref={dialogRef}
        className="career-mock-exit-dialog"
        role="alertdialog"
        aria-labelledby="career-mock-exit-title"
        tabIndex={-1}
      >
        <h2 id="career-mock-exit-title">Ответ ещё не отправлен</h2>
        <p>Если выйти сейчас, этот черновик не сохранится.</p>
        <div className="career-mock-action-row">
          <button type="button" className="career-btn career-btn-secondary" onClick={onStay}>Остаться</button>
          <button type="button" className="career-btn career-btn-ghost" onClick={onLeave}>Выйти без отправки</button>
        </div>
      </section>
    </div>
  );
}

export function InterruptedScreen({ flow, props }: { readonly flow: SupportFlow; readonly props: SupportSimulatorProps }) {
  const session = flow.session;
  if (!session) return <MissingQuestion onRetry={flow.retryLoad} />;
  const current = Math.min(session.currentQuestionIndex + 1, session.questions.length);
  return (
    <div className="career-mock-state-screen">
      <div className="career-mock-state-card">
        <StopCircle aria-hidden="true" className="career-mock-state-icon" />
        <h2>Тренировка остановлена</h2>
        <p>Ответы сохранены. Продолжить можно с вопроса {current} из {session.questions.length}.</p>
        <div className="career-mock-action-row">
          <button type="button" className="career-btn career-btn-primary" disabled={flow.operation !== null} onClick={() => void flow.resume()}>
            <ArrowRight aria-hidden="true" className="career-mock-icon" />
            Продолжить с вопроса {current}
          </button>
          <button type="button" className="career-btn career-btn-secondary" onClick={() => flow.setScreen('setup')}>
            Начать новую тренировку
          </button>
        </div>
      </div>
      <SourcePanel
        vacancy={props.vacancy}
        stories={flow.starStories}
        storiesError={flow.starStoriesError}
        onOpenStories={() => props.onOpenStarStories(() => flow.retryLoad())}
      />
    </div>
  );
}
