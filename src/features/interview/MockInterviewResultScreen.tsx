import { InterviewDiaryAction } from './InterviewDiaryAction';
import { useState } from 'react';
import { ArrowClockwise, CheckCircle, Notebook } from '@phosphor-icons/react';
import type { InterviewSessionView } from './interviewSimulatorApi';
import { deriveInterviewRecommendations, presentInterviewTopics } from './interviewSimulatorPresentation';
import type { InterviewDiaryPort, MockInterviewSimulatorProps } from './mockInterviewSimulatorTypes';
import type { MockInterviewFlow } from './useMockInterviewController';
import { InlineError, MissingQuestion, SourcePanel } from './MockInterviewSupport';

export function ResultScreen({ flow, props }: {
  readonly flow: MockInterviewFlow;
  readonly props: MockInterviewSimulatorProps;
}) {
  const session = flow.session;
  if (!session) return <MissingQuestion onRetry={flow.retryLoad} />;
  const topics = presentInterviewTopics(session.topicSummary);
  const recommendations = deriveInterviewRecommendations(session);
  return (
    <div className="career-mock-layout career-mock-result-layout">
      <main className="career-mock-panel career-mock-result-panel">
        <header className="career-mock-result-heading">
          <CheckCircle aria-hidden="true" className="career-mock-result-icon" />
          <div>
            <h2>Мок-интервью завершено</h2>
            <p>{session.questions.length} вопросов. Это тренировка, не прогноз результата реального интервью.</p>
          </div>
        </header>
        <TopicList topics={topics} />
        <RecommendationList recommendations={recommendations} />
        <ResultActions
          session={session}
          busy={flow.operation !== null}
          diary={props.onWriteDiary}
          onStartAgain={() => flow.setScreen('setup')}
          onBack={props.onBackToPreparation}
        />
      </main>
      <SourcePanel
        session={session}
        stories={flow.starStories}
        storiesError={flow.starStoriesError}
        onOpenStories={() => props.onOpenStarStories(() => flow.retryLoad())}
      />
    </div>
  );
}

function TopicList({ topics }: { readonly topics: ReturnType<typeof presentInterviewTopics> }) {
  return (
    <section className="career-mock-topic-list" aria-labelledby="career-mock-topic-title">
      <h3 id="career-mock-topic-title">Итог по темам</h3>
      <ul>
        {topics.map((topic) => (
          <li key={topic.topic}>
            <div className="career-mock-topic-heading">
              <strong>{topic.topic}</strong>
              <span className="career-mock-status">{topic.status}</span>
            </div>
            <p>{topic.answered} {questionWord(topic.answered)} оценено по рубрике.</p>
          </li>
        ))}
      </ul>
      <p className="career-mock-muted">Общего балла нет. Он не описывает готовность к реальному интервью.</p>
    </section>
  );
}

function RecommendationList({ recommendations }: { readonly recommendations: readonly string[] }) {
  return (
    <section className="career-mock-recommendations" aria-labelledby="career-mock-recommendations-title">
      <h3 id="career-mock-recommendations-title">Что подготовить перед следующим интервью</h3>
      {recommendations.length ? (
        <ul>{recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : <p>По сохранённым ответам нет рекомендаций по рубрике.</p>}
    </section>
  );
}

function ResultActions({ session, busy, diary, onStartAgain, onBack }: {
  readonly session: InterviewSessionView;
  readonly busy: boolean;
  readonly diary?: InterviewDiaryPort;
  readonly onStartAgain: () => void;
  readonly onBack: () => void;
}) {
  const [diaryError, setDiaryError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const writeDiary = async () => {
    if (!diary) return;
    setWriting(true);
    setDiaryError(null);
    try {
      await diary({ session });
    } catch {
      setDiaryError('Запись в дневник не создана. Попробуйте ещё раз.');
    } finally {
      setWriting(false);
    }
  };
  return (
    <div className="career-mock-result-actions">
      <button type="button" className="career-btn career-btn-primary" disabled={busy} onClick={onStartAgain}>
        <ArrowClockwise aria-hidden="true" className="career-mock-icon" />
        Пройти заново
      </button>
      {!diary ? <InterviewDiaryAction key={session.id} sessionId={session.id} /> : null}
      {diary ? (
        <button type="button" className="career-btn career-btn-secondary" disabled={writing} aria-busy={writing} onClick={() => void writeDiary()}>
          <Notebook aria-hidden="true" className="career-mock-icon" />
          {writing ? 'Сохраняем' : 'Записать в дневник'}
        </button>
      ) : null}
      <button type="button" className="career-btn career-btn-ghost" onClick={onBack}>К подготовке</button>
      {diaryError ? <InlineError error={diaryError} /> : null}
    </div>
  );
}

function questionWord(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'вопросов';
  const last = count % 10;
  if (last === 1) return 'вопрос';
  if (last >= 2 && last <= 4) return 'вопроса';
  return 'вопросов';
}
