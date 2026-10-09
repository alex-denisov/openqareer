import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, ListChecks, WarningCircle } from '@phosphor-icons/react';
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
import { ProfileSideRail } from './ProfileSideRail';
import { ProfileSkillsSection } from './ProfileSkillsSection';
import { ProfileCertificatesSection, ProfileProjectsSection } from './ProfileTileSections';
import { ProfileTopcard } from './ProfileTopcard';
import { ProfileTabs, type ProfileTab } from './profileTabs';
import { importedSourceOf, type ImportedSource } from './resumeSourceCoverage';
import { useResumeStudio } from './useResumeStudio';
import { useConsultantSuggestions } from './useConsultantSuggestions';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';
import type { ResumeDraft, ResumeStudioView } from './resumeTypes';
import type { VacancyProfileRequirementRequest } from '../vacancies/vacancyProfileRequirement';
import { ProfileReviewAndVersions } from './ProfileReviewAndVersions';
import './profileScreen.css';

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

function ProfileLoadingState() {
  return (
    <div className="career-profile-screen-state" role="status" aria-live="polite">
      <span className="career-cabinet-skeleton" aria-hidden="true">
        <span className="career-skeleton-line is-wide" />
        <span className="career-skeleton-line" />
        <span className="career-skeleton-line is-short" />
      </span>
      <p>Загружаем профиль…</p>
    </div>
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

function ProfileEmptyState() {
  return (
    <div className="career-profile-screen-state">
      <p>Профиль пока пуст. Подключите источник резюме или заполните разделы вручную.</p>
    </div>
  );
}

function isDraftEmpty(draft: ResumeDraft, memory: readonly CandidateMemory[]): boolean {
  return (
    !draft.candidate.fullName?.trim() &&
    !draft.experience.length &&
    !draft.education.length &&
    !(draft.skills?.length ?? 0) &&
    !memory.some((item) => item.status === 'confirmed' && item.domain === 'responsibility')
  );
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

  if (loading) {
    return (
      <div className="career-profile-screen-view">
        <ProfileLoadingState />
      </div>
    );
  }
  if (error || !draft) {
    return (
      <div className="career-profile-screen-view">
        <ProfileErrorState message={error} onRetry={onRetry} />
      </div>
    );
  }
  if (isDraftEmpty(draft, memory)) {
    return (
      <div className="career-profile-screen-view">
        <ProfileEmptyState />
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
    <div className="career-profile-screen-view" data-profile-tab={tab}>
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
      />
      {tab === 'skills' ? (
        <div
          id="profile-panel-skills"
          className="career-profile-screen-tab-panel"
          role="tabpanel"
          aria-labelledby="profile-tab-skills"
          tabIndex={0}
        >
          <div className="career-profile-screen-panel career-profile-screen-skill-tab">
            <ProfileSkillsSection draft={draft} saving={saving} onSectionSave={onSectionSave} />
            {props.onOpenExpert ? (
              <button type="button" className="career-quiet-button" onClick={props.onOpenExpert}>
                <ListChecks size={16} aria-hidden="true" />
                Пройти квиз по навыкам
              </button>
            ) : null}
          </div>
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
          />
          <div className="career-profile-screen-layout">
            <div className="career-profile-screen-main-col">
              <ProfileAboutSection
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
                suggestions={props.suggestions}
                onAcceptSuggestion={props.onAcceptSuggestion}
                onDismissSuggestion={props.onDismissSuggestion}
                onRevertSuggestion={props.onRevertSuggestion}
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
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
              />
              <ProfileProjectsSection draft={draft} saving={saving} onSectionSave={onSectionSave} />
              <ProfileCoursesSection
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
                importedLabel={importedSource?.label}
              />
              <ProfileCertificatesSection
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
              />
              <ProfileLanguagesSection
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
              />
              <ProfileRecommendationsSection
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
              />
              <ProfileAchievementsSection
                draft={draft}
                saving={saving}
                onSectionSave={onSectionSave}
              />
            </div>
            <ProfileSideRail draft={draft} />
          </div>
        </div>
      )}
    </div>
  );
}

interface ProfileScreenViewProps {
  readonly candidateId: string;
  readonly memory: readonly CandidateMemory[];
  readonly importedSources?: readonly ImportedSourceSummary[];
  readonly onRefreshFacts?: () => Promise<void> | void;
  readonly onOpenConnections?: () => void;
  readonly onOpenExpert?: () => void;
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
function useConnectionStatuses(): readonly CandidateConnection[] | undefined {
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
  }, []);
  return connections;
}

function useSectionSaveHandler(state: ReturnType<typeof useResumeStudio>) {
  return useCallback(
    async (next: ResumeDraft) => {
      state.setDraft(next);
      return state.save(next);
    },
    [state],
  );
}

function useProfileScreenController(props: ProfileScreenViewProps) {
  const { candidateId, onRefreshFacts } = props;
  const state = useResumeStudio(onRefreshFacts);
  const connections = useConnectionStatuses();
  const onSectionSave = useSectionSaveHandler(state);
  const reloadResume = state.reload;
  const refreshProfile = useCallback(async () => {
    await reloadResume();
    await onRefreshFacts?.();
  }, [onRefreshFacts, reloadResume]);
  const consultant = useConsultantSuggestions(candidateId, refreshProfile);
  return {
    state,
    connections,
    onSectionSave,
    refreshProfile,
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

function ProfileScreenSurfaceWithController({
  props,
  controller,
  onVacancySuggestionPrepared,
}: {
  readonly props: ProfileScreenViewProps;
  readonly controller: ReturnType<typeof useProfileScreenController>;
  readonly onVacancySuggestionPrepared: (commandId: string) => Promise<void>;
}) {
  const { state, connections, onSectionSave, refreshProfile, consultant } = controller;
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
