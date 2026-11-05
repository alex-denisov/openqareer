import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CalendarBlank, CheckCircle, Microphone, PencilSimple, Sparkle } from '@phosphor-icons/react';
import { formatInterviewMoment, presentInterviewLength, questionWord } from './interviewSimulatorPresentation';
import type { MockInterviewVacancy } from './mockInterviewSimulatorTypes';
import type { MockInterviewFlow } from './useMockInterviewController';

const SCREEN_TITLES: Record<MockInterviewFlow['screen'], string> = {
  setup: 'Мок-интервью',
  preparing: 'Вопрос',
  question: 'Вопрос',
  voice: 'Вопрос',
  review: 'Разбор',
  interrupted: 'Пауза',
  result: 'Итог',
  paywall: 'Доступ',
};

/** Шапка 390: назад, заголовок состояния, консультант. */
export function MockInterviewHeader({ screen, onBack, onAskConsultant }: {
  readonly screen: MockInterviewFlow['screen'];
  readonly onBack: () => void;
  readonly onAskConsultant?: () => void;
}) {
  return (
    <header className="career-mock-header">
      <button type="button" className="career-mock-icon-button" aria-label="Назад к подготовке" onClick={onBack}>
        <ArrowLeft aria-hidden="true" className="career-mock-icon" />
      </button>
      <h1 id="career-mock-title">{SCREEN_TITLES[screen]}</h1>
      {onAskConsultant ? (
        <button type="button" className="career-mock-icon-button" aria-label="Спросить консультанта" onClick={onAskConsultant}>
          <Sparkle aria-hidden="true" className="career-mock-icon" />
        </button>
      ) : <span className="career-mock-header-spacer" aria-hidden="true" />}
    </header>
  );
}

/**
 * M1: на 1440 тренажёр открыт под шапкой кабинета, как другие разделы. Заголовок раздела
 * в этой шапке на время тренировки — «Мок-интервью»; колокольчик остаётся живым.
 */
export function DesktopSectionTitle({ screen }: { readonly screen: MockInterviewFlow['screen'] }) {
  const [topbar, setTopbar] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbar(document.querySelector<HTMLElement>('.career-desktop-topbar'));
  }, []);
  if (!topbar) return null;
  return createPortal(<h1 className="career-mock-section-title-portal">{SCREEN_TITLES[screen]}</h1>, topbar);
}

/** M2: «Мок-интервью: компания, роль», чип даты интервью, «Прогресс сохраняется» и строка о длине. */
export function MockInterviewSessionHeader({ vacancy, flow, onBack }: {
  readonly vacancy: MockInterviewVacancy;
  readonly flow: MockInterviewFlow;
  readonly onBack: () => void;
}) {
  const interviewAt = vacancy.interviewAt ? formatInterviewMoment(vacancy.interviewAt) : null;
  return (
    <section className="career-mock-session-header" aria-label="Текущая тренировка">
      <div className="career-mock-session-bar">
        <button type="button" className="career-mock-icon-button" aria-label="Назад к подготовке" onClick={onBack}>
          <ArrowLeft aria-hidden="true" className="career-mock-icon" />
        </button>
        <h2>Мок-интервью: {vacancy.company ? `${vacancy.company}, ` : ''}{vacancy.title}</h2>
        {flow.screen === 'setup' && interviewAt ? (
          <span className="career-mock-date-chip">
            <CalendarBlank aria-hidden="true" className="career-mock-icon" />
            Интервью {interviewAt}
          </span>
        ) : null}
        {flow.screen !== 'setup' && flow.session ? <SessionChip flow={flow} /> : null}
        <span className="career-mock-session-status">
          <CheckCircle aria-hidden="true" className="career-mock-icon" />
          Прогресс сохраняется
        </span>
      </div>
      <p className="career-mock-session-summary">{sessionSummary(flow)}</p>
    </section>
  );
}

function SessionChip({ flow }: { readonly flow: MockInterviewFlow }) {
  if (flow.session?.status === 'completed') {
    return (
      <span className="career-mock-mode-chip is-done">
        <CheckCircle aria-hidden="true" className="career-mock-icon" />
        Завершено
      </span>
    );
  }
  if (flow.session?.status === 'interrupted') return <span className="career-mock-mode-chip">Прервано</span>;
  const voice = flow.screen === 'voice' || (flow.screen !== 'question' && flow.session?.mode === 'voice');
  return (
    <span className="career-mock-mode-chip">
      {voice ? <Microphone aria-hidden="true" className="career-mock-icon" /> : <PencilSimple aria-hidden="true" className="career-mock-icon" />}
      {voice ? 'Голосом' : 'Текстом'}
    </span>
  );
}

function sessionSummary(flow: MockInterviewFlow): string {
  const session = flow.session;
  const question = flow.currentQuestion;
  if (flow.screen === 'setup' || !session) {
    return `${presentInterviewLength()}. Можно остановиться и вернуться: ответы сохраняются.`;
  }
  if (session.status === 'completed') {
    const answered = session.questions.filter((item) => item.answer).length;
    return `Мок-интервью завершено: ${answered} ${questionWord(answered)}, ${sessionMinutes(session)} мин. Это тренировка, не прогноз результата.`;
  }
  const position = `Вопрос ${Math.min(session.currentQuestionIndex + 1, session.questions.length)} из ${session.questions.length}`;
  if (flow.screen === 'voice') return `${position}. Отвечайте вслух, можно остановиться в любой момент.`;
  if (flow.screen === 'review') {
    const rubric = question?.type === 'system_design' ? 'System Design' : 'STAR';
    return `${position}: разбор ответа. Оценка по критериям ${rubric}, сделана моделью.`;
  }
  if (question?.storyTitle) return `${position} по вашей STAR-истории «${question.storyTitle}».`;
  return `${position}. Отвечайте текстом или голосом.`;
}

function sessionMinutes(session: { readonly startedAt: string; readonly updatedAt: string }): number {
  const elapsed = Date.parse(session.updatedAt) - Date.parse(session.startedAt);
  return Number.isFinite(elapsed) ? Math.max(1, Math.round(elapsed / 60_000)) : 1;
}

/** 390: заголовок состояния над карточкой — «Вопрос 4 из 10», «Разбор ответа», «Мок-интервью завершено». */
export function MobileStateHero({ flow }: { readonly flow: MockInterviewFlow }) {
  const session = flow.session;
  if (!session || flow.screen === 'setup') return null;
  const position = `Вопрос ${Math.min(session.currentQuestionIndex + 1, session.questions.length)} из ${session.questions.length}`;
  const title = session.status === 'completed'
    ? 'Мок-интервью завершено'
    : flow.screen === 'review' ? 'Разбор ответа' : position;
  return (
    <div className="career-mock-mobile-hero">
      <h2>{title}</h2>
      <p>{withoutPosition(withoutPosition(sessionSummary(flow), position), 'Мок-интервью завершено')}</p>
      {session.status === 'completed' ? (
        <span className="career-mock-result-status">
          <CheckCircle aria-hidden="true" className="career-mock-icon" />
          Завершено
        </span>
      ) : null}
    </div>
  );
}

function withoutPosition(summary: string, position: string): string {
  if (!summary.startsWith(position)) return summary;
  const rest = summary.slice(position.length).replace(/^[.:]?\s*/, '').replace(/^по /, 'По ');
  return rest.charAt(0).toLocaleUpperCase('ru-RU') + rest.slice(1);
}
