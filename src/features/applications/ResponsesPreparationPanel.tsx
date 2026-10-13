import { useEffect, useMemo, useState } from 'react';
import {
  CalendarBlank,
  EnvelopeSimple,
  FileText,
  Notebook,
  WarningCircle,
} from '@phosphor-icons/react';
import type { ApplicationView } from './applicationsApi';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { StarStoriesModal } from '../interview/StarStoriesModal';
import { getStarStories } from '../interview/starStoriesApi';
import type { StarStoriesSnapshot } from '../../../shared/starStories';
import { InterviewDebriefControl } from './ResponsesCardStageControls';
import { humanSourceLabel } from './sourceLabels';
import './responses-preparation.css';

type ExpertHandler = (
  stage: CoachTurnStage,
  subject?: CoachTurnSubject,
  subjectTitle?: string,
) => void;

interface StarStoriesState {
  readonly snapshot?: StarStoriesSnapshot;
  readonly loading: boolean;
  readonly error?: string;
  readonly retry: () => void;
}

export function ResponsesPreparationPanel({
  applications,
  onOpenExpert,
  onRefresh,
}: {
  readonly applications: readonly ApplicationView[];
  readonly onRefresh: () => void;
  readonly onOpenExpert?: ExpertHandler;
}) {
  const { interviews, interviewId, setInterviewId, selectedInterview } =
    useInterviewSelection(applications);
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [storiesOpen, setStoriesOpen] = useState(false);
  const stories = useStarStories();
  const details = getInterviewPreparationDetails(selectedInterview, onOpenExpert);
  return (
    <div className="career-responses-preparation" aria-label="Подготовка к интервью">
      <StarStoriesSection stories={stories} onOpen={() => setStoriesOpen(true)} />
      <InterviewPreparationSection
        interviews={interviews}
        selectedInterview={selectedInterview}
        interviewId={interviewId}
        onInterviewChange={setInterviewId}
        onRefresh={onRefresh}
        onStart={() => setPreparationOpen(true)}
      />
      <PreparationDialogs
        selectedInterview={selectedInterview}
        title={details.title}
        company={details.company}
        preparationOpen={preparationOpen}
        storiesOpen={storiesOpen}
        askConsultant={details.askConsultant}
        onClosePreparation={() => setPreparationOpen(false)}
        onCloseStories={() => setStoriesOpen(false)}
        onOpenStories={() => {
          setPreparationOpen(false);
          setStoriesOpen(true);
        }}
      />
    </div>
  );
}

function useInterviewSelection(applications: readonly ApplicationView[]) {
  const interviews = useMemo(
    () => applications.filter((application) => application.stage === 'interview'),
    [applications],
  );
  const [interviewId, setInterviewId] = useState(interviews[0]?.id ?? '');
  useEffect(() => {
    if (!interviews.some((application) => application.id === interviewId)) {
      setInterviewId(interviews[0]?.id ?? '');
    }
  }, [interviewId, interviews]);
  return {
    interviews,
    interviewId,
    setInterviewId,
    selectedInterview: interviews.find((application) => application.id === interviewId),
  };
}

function StarStoriesSection({
  stories,
  onOpen,
}: {
  readonly stories: StarStoriesState;
  readonly onOpen: () => void;
}) {
  const snapshot = stories.snapshot;
  return (
    <section
      className="career-responses-preparation__stories"
      aria-labelledby="responses-star-title"
    >
      <header>
        <div>
          <h2 id="responses-star-title">STAR на фактах профиля</h2>
          {snapshot ? <p>{snapshot.stories.length} сохранённых историй</p> : null}
        </div>
        <button
          type="button"
          className="career-btn career-btn-secondary career-btn-sm"
          onClick={onOpen}
        >
          <Notebook aria-hidden="true" /> Открыть STAR-истории
        </button>
      </header>
      <StoryLoadState stories={stories} />
      {snapshot?.stories.length ? <StarStoryList snapshot={snapshot} /> : null}
    </section>
  );
}

function StoryLoadState({ stories }: { readonly stories: StarStoriesState }) {
  if (stories.loading) return <p role="status">Загружаем STAR-истории…</p>;
  if (stories.error) {
    return (
      <p className="career-responses-preparation__error" role="alert">
        <WarningCircle aria-hidden="true" /> {stories.error}
        <button type="button" onClick={stories.retry}>
          Повторить
        </button>
      </p>
    );
  }
  if (stories.snapshot?.stories.length === 0) {
    return (
      <p role="status">
        STAR-историй пока нет. Здесь появятся истории, связанные с подтверждёнными фактами профиля.
      </p>
    );
  }
  return null;
}

function StarStoryList({ snapshot }: { readonly snapshot: StarStoriesSnapshot }) {
  return (
    <ul className="career-responses-preparation__story-list">
      {snapshot.stories.slice(0, 4).map((story) => (
        <li key={story.id}>
          <strong>{story.title}</strong>
          <span>{story.fields.result}</span>
          <small>
            {story.confidence === 'confirmed'
              ? 'Подтверждено фактами профиля'
              : 'Связь с фактами не подтверждена'}
          </small>
        </li>
      ))}
    </ul>
  );
}

function InterviewPreparationSection({
  interviews,
  selectedInterview,
  interviewId,
  onInterviewChange,
  onRefresh,
  onStart,
}: {
  readonly interviews: readonly ApplicationView[];
  readonly selectedInterview?: ApplicationView;
  readonly interviewId: string;
  readonly onInterviewChange: (id: string) => void;
  readonly onRefresh: () => void;
  readonly onStart: () => void;
}) {
  return (
    <section
      className="career-responses-preparation__interviews"
      aria-labelledby="responses-interviews-title"
    >
      <header>
        <div>
          <h2 id="responses-interviews-title">Интервью и материалы</h2>
          <p>Данные из сохранённых откликов и назначенных интервью.</p>
        </div>
        {interviews.length ? (
          <InterviewSelect
            interviews={interviews}
            value={interviewId}
            onChange={onInterviewChange}
          />
        ) : null}
      </header>
      <InterviewPreparationContent
        application={selectedInterview}
        onRefresh={onRefresh}
        onStart={onStart}
      />
    </section>
  );
}

function InterviewPreparationContent({
  application,
  onRefresh,
  onStart,
}: {
  readonly application?: ApplicationView;
  readonly onRefresh: () => void;
  readonly onStart: () => void;
}) {
  if (!application) {
    return <p role="status">В выбранном периоде нет откликов с назначенным этапом интервью.</p>;
  }
  return (
    <>
      <InterviewMaterials application={application} />
      <InterviewDebriefControl application={application} onRefresh={onRefresh} />
      <button
        type="button"
        className="career-btn career-btn-primary career-btn-sm"
        onClick={onStart}
      >
        Начать мок-интервью
      </button>
    </>
  );
}

function InterviewSelect({
  interviews,
  value,
  onChange,
}: {
  readonly interviews: readonly ApplicationView[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}) {
  return (
    <label>
      <span>Отклик</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {interviews.map((application) => (
          <option key={application.id} value={application.id}>
            {application.vacancy?.companyHidden
              ? (application.vacancy.title ?? 'Вакансия без названия')
              : `${application.vacancy?.company ?? 'Компания не указана'} · ${application.vacancy?.title ?? 'Вакансия без названия'}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function PreparationDialogs({
  selectedInterview,
  title,
  company,
  preparationOpen,
  storiesOpen,
  askConsultant,
  onClosePreparation,
  onCloseStories,
  onOpenStories,
}: {
  readonly selectedInterview?: ApplicationView;
  readonly title: string;
  readonly company?: string;
  readonly preparationOpen: boolean;
  readonly storiesOpen: boolean;
  readonly askConsultant?: () => void;
  readonly onClosePreparation: () => void;
  readonly onCloseStories: () => void;
  readonly onOpenStories: () => void;
}) {
  return (
    <>
      <InterviewPrepModal
        isOpen={preparationOpen}
        onClose={onClosePreparation}
        vacancy={{ id: selectedInterview?.id ?? '', title, company }}
        onAskConsultant={askConsultant}
        onOpenStarStories={onOpenStories}
      />
      <StarStoriesModal
        isOpen={storiesOpen}
        onClose={onCloseStories}
        onAskConsultant={selectedInterview ? askConsultant : undefined}
      />
    </>
  );
}

function InterviewMaterials({ application }: { readonly application: ApplicationView }) {
  const scheduledAt = application.nearestInterview?.scheduledAt;
  const source = application.vacancy?.source;
  return (
    <div className="career-responses-preparation__materials">
      <p className="career-responses-preparation__interview-date">
        <CalendarBlank aria-hidden="true" />
        {scheduledAt ? `Интервью ${formatDateTime(scheduledAt)}` : 'Дата интервью не указана'}
      </p>
      <ul>
        <li>
          <FileText aria-hidden="true" />
          Резюме: {application.materials.resume ? 'подготовлено' : 'не привязано к отклику'}
        </li>
        <li>
          <EnvelopeSimple aria-hidden="true" />
          Письмо: {application.materials.coverLetter ? 'подготовлено' : 'не привязано к отклику'}
        </li>
      </ul>
      <small>Источник: {source ? humanSourceLabel(source) : 'не указан'}</small>
    </div>
  );
}

function useStarStories(): StarStoriesState {
  const [snapshot, setSnapshot] = useState<StarStoriesSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void getStarStories(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(apiErrorMessage(reason, 'Не удалось загрузить STAR-истории.'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);
  return {
    snapshot,
    loading,
    error,
    retry: () => setReloadToken((current) => current + 1),
  };
}

function createInterviewConsultantAction(
  application: ApplicationView | undefined,
  title: string,
  onOpenExpert?: ExpertHandler,
): (() => void) | undefined {
  if (!application || !onOpenExpert) return undefined;
  return () =>
    onOpenExpert('interviews', { kind: 'application', id: application.id }, `Подготовка: ${title}`);
}

function getInterviewPreparationDetails(
  application: ApplicationView | undefined,
  onOpenExpert?: ExpertHandler,
) {
  const title = application?.vacancy?.title ?? 'Вакансия без названия';
  const company = application?.vacancy?.companyHidden
    ? undefined
    : (application?.vacancy?.company ?? undefined);
  return {
    title,
    company,
    askConsultant: createInterviewConsultantAction(application, title, onOpenExpert),
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'дата не указана'
    : date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}
