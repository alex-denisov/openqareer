import { useEffect, useMemo, useState } from 'react';
import { Microphone } from '@phosphor-icons/react';
import type { ApplicationView } from './applicationsApi';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { InterviewPrepModal } from '../interview/InterviewPrepModal';
import { mockInterviewVacancyFromApplication } from '../interview/mockInterviewVacancy';
import { StarStoriesModal } from '../interview/StarStoriesModal';
import { getStarStories } from '../interview/starStoriesApi';
import { usePublishConsultantSuggestion } from '../journey/consultantScreenSuggestion';
import { InterviewDebriefDialog } from './ResponsesCardStageControls';
import { preparationTabSuggestion } from './responsesTabSuggestions';
import type { StarStoriesSnapshot, StarStoryView } from '../../../shared/starStories';
import {
  DebriefCard,
  MockInterviewCard,
  StarStoriesCard,
  type StarStoriesState,
} from './ResponsesPreparationSections';
import './responses-preparation.css';

type ExpertHandler = (
  stage: CoachTurnStage,
  subject?: CoachTurnSubject,
  subjectTitle?: string,
) => void;

interface StoriesModalState {
  readonly open: boolean;
  readonly editStory?: StarStoryView;
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
  const prep = usePreparationState(applications);
  const { interviews, selectedInterview, setPreparationOpen } = prep;
  const stories = useStarStories();
  const { storiesModal, setStoriesModal, closeStories } = useStoriesModal(stories.retry);
  const details = getInterviewPreparationDetails(selectedInterview, onOpenExpert);
  usePreparationSuggestion(applications, stories, prep, () => setStoriesModal({ open: true }));
  return (
    <div className="career-responses-preparation" aria-label="Подготовка к интервью">
      <StarStoriesCard
        stories={stories}
        onEdit={(story) => setStoriesModal({ open: true, editStory: story })}
        onOpenAll={() => setStoriesModal({ open: true })}
      />
      <MockInterviewCard
        interviews={interviews}
        selected={selectedInterview}
        selectedId={prep.interviewId}
        stress={prep.stress}
        onSelect={prep.setInterviewId}
        onStress={prep.setStress}
        onStart={() => setPreparationOpen(true)}
      />
      <DebriefCard applications={interviewsNeedingDebrief(interviews)} onRefresh={onRefresh} />
      {selectedInterview ? <MobileStartCta onStart={() => setPreparationOpen(true)} /> : null}
      <SuggestedDebrief prep={prep} onRefresh={onRefresh} />
      <PreparationDialogs
        preparationOpen={prep.preparationOpen}
        storiesModal={storiesModal}
        selectedInterview={selectedInterview}
        stress={prep.stress}
        details={details}
        onClosePreparation={() => setPreparationOpen(false)}
        onCloseStories={closeStories}
        onOpenStories={() => {
          setPreparationOpen(false);
          setStoriesModal({ open: true });
        }}
      />
    </div>
  );
}

type PreparationState = ReturnType<typeof usePreparationState>;

function usePreparationState(applications: readonly ApplicationView[]) {
  const selection = useInterviewSelection(applications);
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [stress, setStress] = useState(false);
  const [debriefId, setDebriefId] = useState<string | null>(null);
  const startMock = (id: string) => {
    selection.setInterviewId(id);
    setStress(false);
    setPreparationOpen(true);
  };
  return {
    ...selection,
    preparationOpen,
    setPreparationOpen,
    stress,
    setStress,
    debriefId,
    setDebriefId,
    startMock,
  };
}

/** Макет 5 «Подготовка»: предложение консультанта из интервью и STAR-историй вкладки. */
function usePreparationSuggestion(
  applications: readonly ApplicationView[],
  stories: StarStoriesState,
  prep: PreparationState,
  openStories: () => void,
) {
  usePublishConsultantSuggestion(
    preparationTabSuggestion({
      applications,
      storyCount: storyCountOf(stories),
      actions: { startMock: prep.startMock, openDebrief: prep.setDebriefId, openStories },
    }),
  );
}

/** «Заполнить» в предложении консультанта открывает то же окно дебрифа, что строка «Дебриф». */
function SuggestedDebrief({
  prep,
  onRefresh,
}: {
  readonly prep: PreparationState;
  readonly onRefresh: () => void;
}) {
  const application = prep.interviews.find((item) => item.id === prep.debriefId);
  if (!application) return null;
  return (
    <InterviewDebriefDialog
      application={application}
      isOpen
      onClose={() => prep.setDebriefId(null)}
      onRefresh={onRefresh}
    />
  );
}

function storyCountOf(stories: StarStoriesState): number | undefined {
  if (stories.loading || stories.error || !stories.snapshot) return undefined;
  return stories.snapshot.stories.length;
}

function MobileStartCta({ onStart }: { readonly onStart: () => void }) {
  return (
    <div className="career-prep-cta">
      <button type="button" className="career-btn career-btn-primary" onClick={onStart}>
        <Microphone aria-hidden="true" /> Начать мок-интервью
      </button>
    </div>
  );
}

function PreparationDialogs(props: {
  readonly preparationOpen: boolean;
  readonly storiesModal: StoriesModalState;
  readonly selectedInterview?: ApplicationView;
  readonly stress: boolean;
  readonly details: ReturnType<typeof getInterviewPreparationDetails>;
  readonly onClosePreparation: () => void;
  readonly onCloseStories: () => void;
  readonly onOpenStories: () => void;
}) {
  const { details } = props;
  return (
    <>
      {props.preparationOpen ? (
        <InterviewPrepModal
          isOpen
          onClose={props.onClosePreparation}
          vacancy={
            props.selectedInterview
              ? {
                  ...mockInterviewVacancyFromApplication(props.selectedInterview),
                  title: details.title,
                  company: details.company,
                }
              : { id: '', title: details.title, company: details.company }
          }
          onAskConsultant={details.askConsultant}
          startInMockInterview
          initialStressMode={props.stress}
          onOpenStarStories={props.onOpenStories}
        />
      ) : null}
      {props.storiesModal.open ? (
        <StarStoriesModal
          isOpen
          onClose={props.onCloseStories}
          initialEditStory={props.storiesModal.editStory}
          onAskConsultant={props.selectedInterview ? details.askConsultant : undefined}
        />
      ) : null}
    </>
  );
}

/** Interviews that already took place (or have no date): the debrief is still worth writing. */
function interviewsNeedingDebrief(
  interviews: readonly ApplicationView[],
  now: number = Date.now(),
): readonly ApplicationView[] {
  return interviews.filter((application) => {
    const scheduledAt = application.nearestInterview?.scheduledAt;
    if (!scheduledAt) return true;
    const time = new Date(scheduledAt).getTime();
    return Number.isNaN(time) || time <= now;
  });
}

function useStoriesModal(reloadStories: () => void) {
  const [storiesModal, setStoriesModal] = useState<StoriesModalState>({ open: false });
  const closeStories = () => {
    setStoriesModal({ open: false });
    reloadStories();
  };
  return { storiesModal, setStoriesModal, closeStories };
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

function getInterviewPreparationDetails(
  application: ApplicationView | undefined,
  onOpenExpert?: ExpertHandler,
) {
  const title = application?.vacancy?.title ?? 'Вакансия без названия';
  const company = application?.vacancy?.companyHidden
    ? undefined
    : (application?.vacancy?.company ?? undefined);
  const askConsultant =
    application && onOpenExpert
      ? () =>
          onOpenExpert(
            'interviews',
            { kind: 'application', id: application.id },
            `Подготовка: ${title}`,
          )
      : undefined;
  return { title, company, askConsultant };
}
