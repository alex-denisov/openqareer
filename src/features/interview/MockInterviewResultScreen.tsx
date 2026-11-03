import { InterviewDiaryAction } from './InterviewDiaryAction';
import { useState } from 'react';
import {
  ArrowClockwise,
  ArrowRight,
  CheckCircle,
  Circle,
  Notebook,
  WarningCircle,
} from '@phosphor-icons/react';
import type { InterviewSessionView } from './interviewSimulatorApi';
import {
  deriveRecommendationActions,
  type InterviewRecommendation,
  type RecommendationAction,
} from './interviewRecommendations';
import { openProfileView } from './openProfileView';
import {
  formatSourceDate,
  presentInterviewTopics,
  questionWord,
} from './interviewSimulatorPresentation';
import type {
  InterviewDiaryPort,
  MockInterviewSimulatorProps,
} from './mockInterviewSimulatorTypes';
import type { MockInterviewFlow } from './useMockInterviewController';
import { InlineError, MissingQuestion } from './MockInterviewSupport';
import { SourcePanel } from './MockInterviewSourcePanel';

export function ResultScreen({
  flow,
  props,
}: {
  readonly flow: MockInterviewFlow;
  readonly props: MockInterviewSimulatorProps;
}) {
  const session = flow.session;
  if (!session) return <MissingQuestion onRetry={flow.retryLoad} />;
  const topics = presentInterviewTopics(session.topicSummary);
  const recommendations = deriveRecommendationActions(session);
  const runRecommendation: Readonly<Record<RecommendationAction, () => void>> = {
    story: () => props.onOpenStarStories(() => flow.retryLoad()),
    profile: () => openProfileView(props.onBackToPreparation),
    restart: () => flow.setScreen('setup'),
  };
  return (
    <div className="career-mock-layout career-mock-result-layout">
      <main className="career-mock-panel career-mock-result-panel">
        <TopicList topics={topics} />
        <RecommendationList
          recommendations={recommendations}
          interviewAt={props.vacancy.interviewAt}
          busy={flow.operation !== null}
          onRun={(action) => runRecommendation[action]()}
        />
        <ResultActions
          session={session}
          busy={flow.operation !== null}
          diary={props.onWriteDiary}
          onStartAgain={() => flow.setScreen('setup')}
          onBack={props.onBackToPreparation}
        />
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

function TopicList({ topics }: { readonly topics: ReturnType<typeof presentInterviewTopics> }) {
  return (
    <section className="career-mock-topic-list" aria-labelledby="career-mock-topic-title">
      <h2 id="career-mock-topic-title">Итог по темам</h2>
      <ul className="career-mock-criteria">
        {topics.map((topic) => (
          <li key={topic.topic}>
            <TopicIcon status={topic.status} />
            <div>
              <div className="career-mock-criterion-title">
                <strong>{topic.topic}</strong>
                <span
                  className={`career-mock-status career-mock-status--${STATUS_POINTS[topic.status]}`}
                >
                  {topic.status}
                </span>
              </div>
              <p>
                {topic.answered} {questionWord(topic.answered)}, оценено по критериям
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="career-mock-muted">
        Без общего балла: на {topics.reduce((sum, topic) => sum + topic.answered, 0)} ответах он
        ничего не доказывает.
      </p>
    </section>
  );
}

const STATUS_POINTS: Readonly<
  Record<ReturnType<typeof presentInterviewTopics>[number]['status'], string>
> = {
  Есть: '2',
  Частично: '1',
  Нет: '0',
  'Не оценено': 'none',
};

function TopicIcon({
  status,
}: {
  readonly status: ReturnType<typeof presentInterviewTopics>[number]['status'];
}) {
  if (status === 'Есть')
    return <CheckCircle aria-hidden="true" className="career-mock-criterion-icon is-yes" />;
  if (status === 'Частично')
    return <WarningCircle aria-hidden="true" className="career-mock-criterion-icon is-partial" />;
  return <Circle aria-hidden="true" className="career-mock-criterion-icon is-no" />;
}

function RecommendationList({
  recommendations,
  interviewAt,
  busy,
  onRun,
}: {
  readonly recommendations: readonly InterviewRecommendation[];
  readonly interviewAt?: string;
  readonly busy: boolean;
  readonly onRun: (action: RecommendationAction) => void;
}) {
  const date = interviewAt ? formatSourceDate(interviewAt) : null;
  return (
    <section
      className="career-mock-recommendations"
      aria-labelledby="career-mock-recommendations-title"
    >
      <h2 id="career-mock-recommendations-title">
        {date ? `Что сделать до интервью ${date}` : 'Что сделать до интервью'}
      </h2>
      {recommendations.length ? (
        <ul className="career-mock-recommendation-list">
          {recommendations.map((item) => (
            <li key={item.text}>
              <strong>{item.text}</strong>
              <RecommendationButton action={item.action} busy={busy} onRun={onRun} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="career-mock-muted">По сохранённым ответам все критерии закрыты.</p>
      )}
    </section>
  );
}

const RECOMMENDATION_LABELS: Readonly<Record<RecommendationAction, string>> = {
  story: 'Начать',
  restart: 'Начать',
  profile: 'Открыть профиль',
};

function RecommendationButton({
  action,
  busy,
  onRun,
}: {
  readonly action: RecommendationAction;
  readonly busy: boolean;
  readonly onRun: (action: RecommendationAction) => void;
}) {
  const primary = action !== 'profile';
  return (
    <button
      type="button"
      className={`career-btn career-btn-sm ${primary ? 'career-btn-secondary' : 'career-btn-ghost'}`}
      disabled={busy}
      onClick={() => onRun(action)}
    >
      {primary ? <ArrowRight aria-hidden="true" className="career-mock-icon" /> : null}
      {RECOMMENDATION_LABELS[action]}
    </button>
  );
}

function ResultActions({
  session,
  busy,
  diary,
  onStartAgain,
  onBack,
}: {
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
      <button
        type="button"
        className="career-btn career-btn-primary"
        disabled={busy}
        onClick={onStartAgain}
      >
        <ArrowClockwise aria-hidden="true" className="career-mock-icon" />
        Пройти заново
      </button>
      {!diary ? <InterviewDiaryAction key={session.id} sessionId={session.id} /> : null}
      {diary ? (
        <button
          type="button"
          className="career-btn career-btn-secondary"
          disabled={writing}
          aria-busy={writing}
          onClick={() => void writeDiary()}
        >
          <Notebook aria-hidden="true" className="career-mock-icon" />
          {writing ? 'Сохраняем' : 'Записать в дневник'}
        </button>
      ) : null}
      <button type="button" className="career-btn career-btn-ghost" onClick={onBack}>
        К подготовке
      </button>
      {diaryError ? <InlineError error={diaryError} /> : null}
    </div>
  );
}
