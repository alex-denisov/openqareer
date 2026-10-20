import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import {
  getConnections,
  type CandidateConnection,
  type CandidateMemory,
  type ImportedSourceSummary,
} from '../coach/coachApi';
import { CandidateFootprintAuditView } from '../reputation/CandidateFootprintAuditView';
import { ProfileAboutSection } from './ProfileAboutSection';
import { ProfileAchievementsSection } from './ProfileAchievementsSection';
import { ProfileCoursesSection } from './ProfileCoursesSection';
import { ProfileEducationSection } from './ProfileEducationSection';
import { ProfileExperienceSection } from './ProfileExperienceSection';
import { ProfileLanguagesSection } from './ProfileLanguagesSection';
import { ProfileRecommendationsSection } from './ProfileRecommendationsSection';
import {
  ProfileSideRail,
  profileRelocationSummaryStatusFromResponse,
  type ProfileRelocationSummaryStatus,
} from './ProfileSideRail';
import { ProfileCertificatesSection, ProfileProjectsSection } from './ProfileTileSections';
import { ProfileTopcard } from './ProfileTopcard';
import { ProfileTabs, type ProfileTab } from './profileTabs';
import { importedSourceOf, type ImportedSource } from './resumeSourceCoverage';
import { useResumeStudio } from './useResumeStudio';
import { useFootprintFindingCount } from './useFootprintFindingCount';
import { useConsultantSuggestions } from './useConsultantSuggestions';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';
import type { ResumeDraft, ResumeStudioView } from './resumeTypes';
import type { ExperienceRevisionField } from '../../../shared/experienceRevisionField';
import type { VacancyProfileRequirementRequest } from '../vacancies/vacancyProfileRequirement';
import { ProfileResumeVersions, ProfileReviewAndVersions } from './ProfileReviewAndVersions';
import { getRelocationQuestionnaire } from '../relocation/relocationApi';
import type { ProfileFocusRequest, ProfileMobileScene } from './profileMobileNavigation';
import { ProfileEmptyStart } from './ProfileEmptyStart';
import { ProfileMobileScreen } from './ProfileMobileScreen';
import { ProfileDataDialog } from './ProfileDataDialog';
import { ProfileDesktopSkills } from './ProfileDesktopSkills';
import { useProfileDataDialog } from './useProfileDataDialog';
import { ProfileRefreshNotice } from './ProfileRefreshNotice';
import { ProfileScreenLoadingState } from './ProfileScreenLoadingState';
import './profileScreen.css';
import './profileDesktop.css';
import './profileStates.css';

const ANCHORS: readonly { id: string; label: string }[] = [
  { id: 'sec-check', label: 'Проверка' },
  { id: 'sec-ats', label: 'ATS' },
  { id: 'sec-about', label: 'Обо мне' },
  { id: 'sec-experience', label: 'Опыт' },
  { id: 'sec-education', label: 'Образование' },
  { id: 'sec-projects', label: 'Проекты' },
  { id: 'sec-languages', label: 'Языки' },
  { id: 'sec-relocation', label: 'Релокация' },
  { id: 'sec-documents', label: 'Резюме и версии' },
];

function ProfileAnchorNav() {
  return (
    <nav className="career-profile-screen-anchor-nav" aria-label="Разделы профиля">
      {ANCHORS.map((anchor) => (
        <a key={anchor.id} href={`#${anchor.id}`}>
          {anchor.label}
        </a>
      ))}
    </nav>
  );
}

function ProfileErrorState({
  message,
  onRetry,
}: {
  readonly message?: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="career-profile-screen-state" role="alert">
      <WarningCircle size={24} />
      <p>{message ?? 'Не удалось загрузить профиль. Проверьте соединение и повторите запрос.'}</p>
      <button type="button" className="career-quiet-button" onClick={onRetry}>
        <ArrowClockwise size={15} />
        Повторить
      </button>
    </div>
  );
}

function isDraftEmpty(draft: ResumeDraft, memory: readonly CandidateMemory[]): boolean {
  const candidate = draft.candidate;
  const candidateText = [
    candidate.fullName,
    candidate.photoUrl,
    candidate.photoMediaId,
    candidate.headline,
    candidate.about,
    candidate.contact?.email,
    candidate.contact?.phone,
    candidate.contact?.telegram,
    candidate.contact?.location,
    candidate.contact?.linkedinUrl,
    draft.targetRole,
    draft.additional?.citizenship,
    draft.additional?.workSchedule,
    draft.additional?.relocation,
    draft.additional?.driversLicense,
  ];
  const hasCandidateText = candidateText.some((value) => Boolean(value?.trim()));
  const hasContactLinks = candidate.contact?.links?.some((value) => Boolean(value.trim())) ?? false;
  const hasDraftSections =
    draft.experience.length > 0 ||
    draft.education.length > 0 ||
    draft.languages.length > 0 ||
    (draft.skills?.length ?? 0) > 0 ||
    (draft.courses?.length ?? 0) > 0 ||
    (draft.tests?.length ?? 0) > 0 ||
    (draft.recommendations?.length ?? 0) > 0 ||
    (draft.certifications?.length ?? 0) > 0 ||
    (draft.projects?.length ?? 0) > 0 ||
    (draft.achievements?.length ?? 0) > 0;
  const hasConfirmedProfileMemory = memory.some(
    (item) =>
      item.status === 'confirmed' &&
      ['responsibility', 'outcome', 'skill', 'role-evidence'].includes(item.domain),
  );

  return !hasCandidateText && !hasContactLinks && !hasDraftSections && !hasConfirmedProfileMemory;
}

function useDesktopProfileLayout(): boolean {
  const [desktopLayout, setDesktopLayout] = useState(
    () =>
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(min-width: 761px)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 761px)');
    const update = () => setDesktopLayout(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return desktopLayout;
}

export interface ProfileScreenSurfaceProps {
  readonly candidateId: string;
  readonly view?: ResumeStudioView;
  readonly draft?: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly importedSources?: readonly ImportedSourceSummary[];
  readonly importedSource?: ImportedSource;
  readonly loading?: boolean;
  readonly saving?: boolean;
  readonly error?: string;
  readonly saveError?: string;
  readonly onRetry: () => void;
  readonly onDraftChange: (draft: ResumeDraft) => void;
  readonly onSectionSave: (next: ResumeDraft) => Promise<boolean | void> | boolean | void;
  /** Opens «Аккаунт → Подключения», where a real re-import starts (B266). */
  readonly onOpenConnections?: () => void;
  /** hh.ru/LinkedIn status chips in the topcard (C54 п.11); undefined while
   *  the read has not landed. */
  readonly connections?: readonly CandidateConnection[];
  readonly onOpenExpert?: () => void;
  readonly onOpenSkillQuizBank?: () => void;
  readonly onOpenRoleSkillAssessment?: () => void;
  readonly onSuggestAboutWithConsultant?: () => void;
  readonly onCollectExperienceFact?: (
    target: Extract<ProfileFocusRequest, { readonly section: 'experience' }>,
  ) => void;
  readonly onOpenRelocation?: () => void;
  readonly onFillQuestionnaire?: (sectionTitle: string) => void;
  readonly relocationSummary?: ProfileRelocationSummaryStatus;
  readonly profileFocusRequest?: ProfileFocusRequest;
  readonly onProfileFocusHandled?: () => void;
  readonly onMobileSceneChange?: (scene: ProfileMobileScene | null) => void;
  readonly onTabChange?: (tab: ProfileTab) => void;
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onAcceptSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (suggestion: InlineSuggestionItem) => void;
  readonly onRevertSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly vacancyRequirement?: VacancyProfileRequirementRequest;
  readonly onVacancyRequirementHandled?: () => void;
  readonly onVacancySuggestionPrepared?: (commandId: string) => Promise<void> | void;
  readonly onManualExperienceFactAdded?: () => Promise<void> | void;
  /**
   * The profile screen owns its Resume / Skills / Trace tabs.
   */
  readonly tab?: ProfileTab;
}

/**
 * Presentational surface: every state (loading, error, empty, populated) can
 * be asserted without a network, the same split `ResumeStudioSurface` uses.
 * There is no permanent "Сохранить" button (B265 owner remark #5) — every
 * section saves itself when its own edit mode is closed.
 */
// eslint-disable-next-line max-lines-per-function
export function ProfileScreenSurface(props: ProfileScreenSurfaceProps) {
  const desktopProfileLayout = useDesktopProfileLayout();
  const dataDialog = useProfileDataDialog(props, desktopProfileLayout);
  useDesktopProfileFocus(
    props,
    desktopProfileLayout && !dataDialog.open && !dataDialog.managedRequest,
  );
  const {
    candidateId,
    draft,
    memory,
    importedSource,
    loading = false,
    saving = false,
    error,
    saveError,
    onRetry,
    onDraftChange,
    onSectionSave,
    onOpenConnections,
    connections,
    tab = 'resume',
  } = props;
  const traceCount = useFootprintFindingCount(candidateId);

  if (loading && !draft) return <ProfileScreenLoadingState mobile={!desktopProfileLayout} />;
  if (!draft) {
    return (
      <div className="career-profile-screen-view">
        <ProfileErrorState message={error} onRetry={onRetry} />
      </div>
    );
  }
  const draftIsEmpty = isDraftEmpty(draft, memory);
  if (!desktopProfileLayout)
    return <ProfileMobileScreen {...props} draft={draft} isDraftEmpty={draftIsEmpty} />;
  const dialog = dataDialog.open ? (
    <ProfileDataDialog
      {...props}
      draft={draft}
      section={dataDialog.section}
      onSelect={dataDialog.select}
      onClose={dataDialog.close}
    />
  ) : null;
  if (draftIsEmpty) {
    return (
      <div className="career-profile-screen-view">
        {dialog}
        <ProfileEmptyStart
          variant="desktop"
          onOpenConnections={onOpenConnections}
          onOpenExpert={props.onOpenExpert}
          onFillManually={() => dataDialog.select()}
          onImported={onRetry}
        />
        {props.vacancyRequirement ? (
          <ProfileExperienceSection
            candidateId={candidateId}
            draft={draft}
            memory={memory}
            saving={saving}
            onSectionSave={onSectionSave}
            vacancyRequirement={props.vacancyRequirement}
            onVacancyRequirementHandled={props.onVacancyRequirementHandled}
            onVacancySuggestionPrepared={props.onVacancySuggestionPrepared}
            onManualExperienceFactAdded={props.onManualExperienceFactAdded}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="career-profile-screen-view"
      data-profile-tab={tab}
      aria-busy={loading || saving || undefined}
    >
      {dialog}
      <ProfileRefreshNotice error={error} onRetry={onRetry} />
      <div className="career-profile-screen-header-row">
        <ProfileTopcard
          draft={draft}
          importedSources={props.importedSources}
          importedSource={importedSource}
          updatedAt={props.view?.savedAt?.updatedAt}
          reader={props.view?.reader ?? null}
          onDraftChange={onDraftChange}
          onSectionSave={onSectionSave}
          saving={saving}
          connections={connections}
          onOpenConnections={onOpenConnections}
          memory={memory}
          onEdit={() => dataDialog.select('name')}
          onOpenData={() => dataDialog.select()}
        />
      </div>
      {saveError ? (
        <p className="career-resume-error" role="alert">
          {saveError}
        </p>
      ) : null}
      <ProfileTabs
        tab={tab}
        onTab={props.onTabChange ?? (() => undefined)}
        skillsCount={draft.skills?.length ?? 0}
        traceCount={traceCount}
      />
      {tab === 'skills' ? (
        <div
          id="profile-panel-skills"
          className="career-profile-screen-tab-panel"
          role="tabpanel"
          aria-labelledby="profile-tab-skills"
          tabIndex={0}
        >
          <ProfileDesktopSkills {...props} draft={draft} />
        </div>
      ) : tab === 'trace' ? (
        <div
          id="profile-panel-trace"
          className="career-profile-screen-tab-panel"
          role="tabpanel"
          aria-labelledby="profile-tab-trace"
          tabIndex={0}
        >
          <CandidateFootprintAuditView key={candidateId} candidateId={candidateId} />
        </div>
      ) : (
        <div
          id="profile-panel-resume"
          className="career-profile-screen-tab-panel"
          role="tabpanel"
          aria-labelledby="profile-tab-resume"
          tabIndex={0}
        >
          <ProfileAnchorNav />
          <ProfileReviewAndVersions
            draft={draft}
            memory={memory}
            view={props.view}
            onOpenExpert={props.onOpenExpert}
            onFillQuestionnaire={props.onFillQuestionnaire}
            onTabChange={props.onTabChange}
            desktopLayout={desktopProfileLayout}
          />
          <div
            className={`career-profile-screen-layout${desktopProfileLayout ? ' is-single-column' : ''}`}
          >
            <div className="career-profile-screen-main-col">
              <ProfileAboutSection
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
                suggestions={props.suggestions}
                onAcceptSuggestion={props.onAcceptSuggestion}
                onDismissSuggestion={props.onDismissSuggestion}
                onRevertSuggestion={props.onRevertSuggestion}
                onSuggestWithConsultant={props.onSuggestAboutWithConsultant}
              />
              <ProfileExperienceSection
                candidateId={candidateId}
                draft={draft}
                memory={memory}
                saving={saving}
                onSectionSave={onSectionSave}
                suggestions={props.suggestions}
                onAcceptSuggestion={props.onAcceptSuggestion}
                onDismissSuggestion={props.onDismissSuggestion}
                onRevertSuggestion={props.onRevertSuggestion}
                vacancyRequirement={props.vacancyRequirement}
                onVacancyRequirementHandled={props.onVacancyRequirementHandled}
                onVacancySuggestionPrepared={props.onVacancySuggestionPrepared}
                onManualExperienceFactAdded={props.onManualExperienceFactAdded}
              />
              <ProfileEducationSection
                onAddCourse={() => dataDialog.select('courses')}
                onConsultCourses={
                  props.onFillQuestionnaire ? () => props.onFillQuestionnaire?.('Курсы') : undefined
                }
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
              />
              <ProfileProjectsSection draft={draft} saving={saving} onSectionSave={onSectionSave} />
              {!desktopProfileLayout ? (
                <ProfileCoursesSection
                  draft={draft}
                  saving={saving}
                  onSectionSave={onSectionSave}
                  importedLabel={importedSource?.label}
                />
              ) : null}
              {!desktopProfileLayout ? (
                <ProfileCertificatesSection
                  draft={draft}
                  saving={saving}
                  onSectionSave={onSectionSave}
                />
              ) : null}
              <ProfileLanguagesSection
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
              />
              {!desktopProfileLayout ? (
                <ProfileRecommendationsSection
                  draft={draft}
                  saving={saving}
                  onSectionSave={onSectionSave}
                />
              ) : null}
              {!desktopProfileLayout ? (
                <ProfileAchievementsSection
                  draft={draft}
                  saving={saving}
                  onSectionSave={onSectionSave}
                />
              ) : null}
            </div>
            <ProfileSideRail
              draft={draft}
              desktopLayout={desktopProfileLayout}
              relocationSummary={props.relocationSummary}
              onOpenRelocation={props.onOpenRelocation}
            />
            {desktopProfileLayout ? (
              <ProfileResumeVersions draft={draft} memory={memory} view={props.view} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

interface ProfileScreenViewProps {
  readonly candidateId: string;
  readonly refreshKey?: number;
  readonly memory: readonly CandidateMemory[];
  readonly importedSources?: readonly ImportedSourceSummary[];
  readonly onRefreshFacts?: () => Promise<void> | void;
  readonly onOpenConnections?: () => void;
  readonly onOpenExpert?: () => void;
  readonly onOpenSkillQuizBank?: () => void;
  readonly onOpenRoleSkillAssessment?: () => void;
  readonly onSuggestAboutWithConsultant?: () => void;
  readonly onCollectExperienceFact?: (
    target: Extract<ProfileFocusRequest, { readonly section: 'experience' }>,
  ) => void;
  readonly onOpenRelocation?: () => void;
  readonly onFillQuestionnaire?: (sectionTitle: string) => void;
  readonly profileFocusRequest?: ProfileFocusRequest;
  readonly onProfileFocusHandled?: () => void;
  readonly onMobileSceneChange?: (scene: ProfileMobileScene | null) => void;
  readonly onTabChange?: (tab: ProfileTab) => void;
  readonly tab?: ProfileTab;
  readonly vacancyRequirement?: VacancyProfileRequirementRequest;
  readonly onVacancyRequirementHandled?: () => void;
}

/**
 * hh.ru/LinkedIn status chips (C54 п.11) read the same connections endpoint
 * `AccountConnectionsManager` does; a failed read shows «Не подключено»
 * rather than blocking the profile — the chip still opens the real panel to
 * retry (mirrors `AccountConnectionsManager`'s own fallback).
 */
function useConnectionStatuses(refreshKey?: number): readonly CandidateConnection[] | undefined {
  const [connections, setConnections] = useState<CandidateConnection[]>();
  useEffect(() => {
    let current = true;
    void getConnections()
      .then((loaded) => {
        if (current) setConnections(loaded);
      })
      .catch(() => {
        if (current) setConnections([]);
      });
    return () => {
      current = false;
    };
  }, [refreshKey]);
  return connections;
}

function useSectionSaveHandler(state: ReturnType<typeof useResumeStudio>) {
  return useCallback(async (next: ResumeDraft) => state.save(next), [state]);
}

function useProfileRelocationSummary(
  candidateId: string,
  refreshKey?: number,
): ProfileRelocationSummaryStatus {
  const [status, setStatus] = useState<ProfileRelocationSummaryStatus>('loading');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setStatus('loading');
    void getRelocationQuestionnaire(controller.signal)
      .then((response) => {
        if (active) setStatus(profileRelocationSummaryStatusFromResponse(response));
      })
      .catch(() => {
        if (active) setStatus('unknown');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [candidateId, refreshKey]);

  return status;
}

function profileFocusDestination(
  request: ProfileFocusRequest,
  desktopLayout: boolean,
): { readonly tab: ProfileTab; readonly targetId: string } {
  if (request.section === 'ats') return { tab: 'resume', targetId: 'sec-ats' };
  if (request.section === 'review') return { tab: 'resume', targetId: 'sec-check' };
  if (request.section === 'name' || request.section === 'contacts') {
    return { tab: 'resume', targetId: 'career-profile-screen-topcard' };
  }
  if (request.section === 'experience') {
    return { tab: 'resume', targetId: 'sec-experience' };
  }
  const sections: Record<
    Exclude<ProfileFocusRequest['section'], 'ats' | 'review' | 'name' | 'contacts' | 'experience'>,
    string
  > = {
    education: 'sec-education',
    projects: 'sec-projects',
    skills: 'sec-skills',
    languages: 'sec-languages',
    courses: 'sec-courses',
    certifications: 'sec-certificates',
    recommendations: 'sec-recommendations',
    achievements: 'sec-achievements',
  };
  return {
    tab:
      desktopLayout &&
      ['skills', 'courses', 'certifications', 'recommendations', 'achievements'].includes(
        request.section,
      )
        ? 'skills'
        : 'resume',
    targetId: sections[request.section],
  };
}

function focusSectionTarget(targetId: string): boolean {
  const section = document.getElementById(targetId);
  if (!section) return false;
  const control = section.querySelector<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
  );
  if (control) {
    control.focus();
    return true;
  }
  section.tabIndex = -1;
  section.focus();
  return true;
}

function focusTopcardInput(section: 'name' | 'contacts'): boolean {
  const topcard = document.getElementById('career-profile-screen-topcard');
  const fieldName = section === 'name' ? 'Имя' : 'Email';
  const input = Array.from(topcard?.querySelectorAll<HTMLLabelElement>('label') ?? [])
    .find((label) => label.querySelector('span')?.textContent?.trim() === fieldName)
    ?.querySelector<HTMLInputElement>('input');
  input?.focus();
  return Boolean(input);
}

function focusTopcardField(section: 'name' | 'contacts'): boolean {
  const topcard = document.getElementById('career-profile-screen-topcard');
  if (!topcard) return false;
  const editButton = Array.from(topcard.querySelectorAll('button')).find((button) =>
    button.textContent?.trim().includes('Изменить'),
  );
  if (editButton && !topcard.querySelector('.career-profile-screen-edit-body')) {
    editButton.click();
    window.requestAnimationFrame(() => focusTopcardInput(section));
    return true;
  }
  return focusTopcardInput(section) || focusSectionTarget('career-profile-screen-topcard');
}

function focusExperienceField(
  experienceId: string | undefined,
  field: ExperienceRevisionField,
): boolean {
  const position = Array.from(document.querySelectorAll<HTMLElement>('[data-experience-id]')).find(
    (element) => element.dataset.experienceId === experienceId,
  );
  if (!position) return focusSectionTarget('sec-experience');
  const input = position.querySelector<HTMLInputElement>(`input[name="${field}"]:not([disabled])`);
  if (input) {
    input.focus();
    return true;
  }
  const editButton = position.querySelector<HTMLButtonElement>(
    'button[aria-label^="Редактировать место целиком:"]',
  );
  if (!editButton) return focusSectionTarget('sec-experience');
  editButton.click();
  window.requestAnimationFrame(() => {
    position.querySelector<HTMLInputElement>(`input[name="${field}"]:not([disabled])`)?.focus();
  });
  return true;
}

function experienceIdForRequest(
  request: Extract<ProfileFocusRequest, { readonly section: 'experience' }>,
  draft: ResumeDraft,
): string | undefined {
  if (request.experienceId) return request.experienceId;
  return draft.experience.find(
    (item) =>
      (!request.employer || item.employer === request.employer) &&
      (!request.title || item.title === request.title),
  )?.id;
}

function focusDesktopProfileRequest(
  request: ProfileFocusRequest,
  target: { readonly tab: ProfileTab; readonly targetId: string },
  draft: ResumeDraft,
): boolean {
  if (request.section === 'name' || request.section === 'contacts') {
    return focusTopcardField(request.section);
  }
  if (request.section === 'experience' && request.field) {
    return focusExperienceField(experienceIdForRequest(request, draft), request.field);
  }
  return focusSectionTarget(target.targetId);
}

function useDesktopProfileFocus(props: ProfileScreenSurfaceProps, desktopLayout: boolean): void {
  const { profileFocusRequest, draft, tab, onProfileFocusHandled, onTabChange } = props;
  useEffect(() => {
    const request = profileFocusRequest;
    if (!desktopLayout || !request || !draft) return;
    const destination = profileFocusDestination(request, desktopLayout);
    if ((tab ?? 'resume') !== destination.tab) {
      onTabChange?.(destination.tab);
      return;
    }
    window.requestAnimationFrame(() => {
      if (focusDesktopProfileRequest(request, destination, draft)) {
        onProfileFocusHandled?.();
      }
    });
  }, [desktopLayout, draft, onProfileFocusHandled, onTabChange, profileFocusRequest, tab]);
}

function useProfileScreenController(props: ProfileScreenViewProps) {
  const { candidateId, onRefreshFacts } = props;
  const state = useResumeStudio(onRefreshFacts, props.refreshKey);
  const connections = useConnectionStatuses(props.refreshKey);
  const onSectionSave = useSectionSaveHandler(state);
  const reloadResume = state.reload;
  const refreshProfile = useCallback(async () => {
    await reloadResume();
    await onRefreshFacts?.();
  }, [onRefreshFacts, reloadResume]);
  const consultant = useConsultantSuggestions(candidateId, refreshProfile, props.refreshKey);
  const relocationSummary = useProfileRelocationSummary(candidateId, props.refreshKey);
  return {
    state,
    connections,
    onSectionSave,
    refreshProfile,
    relocationSummary,
    consultant,
  };
}

/**
 * Connects the candidate-scoped resume API to `ProfileScreenSurface` — the
 * rail's «Профиль» section, replacing Resume Studio wholesale (B265). Uses
 * the same `useResumeStudio` hook Resume Studio does, so a draft saved here
 * and one saved there can never disagree about the wire contract.
 */
function useVacancySuggestionReveal(
  reloadSuggestions: () => Promise<void>,
  suggestions: readonly InlineSuggestionItem[],
) {
  const [suggestionToReveal, setSuggestionToReveal] = useState<string>();
  const revealSuggestion = useCallback(
    async (commandId: string) => {
      await reloadSuggestions();
      setSuggestionToReveal(commandId);
    },
    [reloadSuggestions],
  );
  useEffect(() => {
    if (!suggestionToReveal) return;
    const suggestion = document.querySelector<HTMLElement>(
      `[data-testid="consultant-suggestion-${suggestionToReveal}"]`,
    );
    if (!suggestion) return;
    suggestion.scrollIntoView({ block: 'center' });
    setSuggestionToReveal(undefined);
  }, [suggestions, suggestionToReveal]);
  return revealSuggestion;
}

// eslint-disable-next-line max-lines-per-function -- Keep controller-to-surface props explicit for review.
function ProfileScreenSurfaceWithController({
  props,
  controller,
  onVacancySuggestionPrepared,
}: {
  readonly props: ProfileScreenViewProps;
  readonly controller: ReturnType<typeof useProfileScreenController>;
  readonly onVacancySuggestionPrepared: (commandId: string) => Promise<void>;
}) {
  const { state, connections, onSectionSave, refreshProfile, relocationSummary, consultant } =
    controller;
  return (
    <ProfileScreenSurface
      candidateId={props.candidateId}
      view={state.view}
      draft={state.draft}
      memory={props.memory}
      importedSource={importedSourceOf(props.importedSources)}
      loading={state.loading}
      saving={state.saving}
      error={state.error}
      saveError={state.saveError}
      onRetry={state.reload}
      onDraftChange={state.setDraft}
      onSectionSave={onSectionSave}
      onOpenConnections={props.onOpenConnections}
      connections={connections}
      importedSources={props.importedSources}
      onOpenExpert={props.onOpenExpert}
      onOpenSkillQuizBank={props.onOpenSkillQuizBank}
      onOpenRoleSkillAssessment={props.onOpenRoleSkillAssessment}
      onSuggestAboutWithConsultant={props.onSuggestAboutWithConsultant}
      onCollectExperienceFact={props.onCollectExperienceFact}
      onOpenRelocation={props.onOpenRelocation}
      relocationSummary={relocationSummary}
      profileFocusRequest={props.profileFocusRequest}
      onProfileFocusHandled={props.onProfileFocusHandled}
      onMobileSceneChange={props.onMobileSceneChange}
      onFillQuestionnaire={props.onFillQuestionnaire}
      onTabChange={props.onTabChange}
      tab={props.tab}
      vacancyRequirement={props.vacancyRequirement}
      onVacancyRequirementHandled={props.onVacancyRequirementHandled}
      onVacancySuggestionPrepared={onVacancySuggestionPrepared}
      onManualExperienceFactAdded={refreshProfile}
      suggestions={consultant.suggestions}
      onAcceptSuggestion={consultant.acceptSuggestion}
      onDismissSuggestion={consultant.dismissSuggestion}
      onRevertSuggestion={consultant.revertSuggestion}
    />
  );
}

export function ProfileScreenView(props: ProfileScreenViewProps) {
  const controller = useProfileScreenController(props);
  const onVacancySuggestionPrepared = useVacancySuggestionReveal(
    controller.consultant.reload,
    controller.consultant.suggestions,
  );
  return (
    <ProfileScreenSurfaceWithController
      props={props}
      controller={controller}
      onVacancySuggestionPrepared={onVacancySuggestionPrepared}
    />
  );
}
