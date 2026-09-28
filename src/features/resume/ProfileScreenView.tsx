import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import {
  getConnections,
  updateAccountProfile,
  type CandidateConnection,
  type CandidateMemory,
  type ImportedSourceSummary,
} from '../coach/coachApi';
import { applyRoutePremises } from '../cabinet/routePremises';
import { CandidateReputationAuditView } from '../reputation/CandidateReputationAuditView';
import { normalizeCandidateRegions } from '../workspace/candidateRegions';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { ProfileAboutSection } from './ProfileAboutSection';
import { ProfileAchievementsSection } from './ProfileAchievementsSection';
import { ProfileCoursesSection } from './ProfileCoursesSection';
import { ProfileDocumentMenu } from './ProfileDocumentMenu';
import { ProfileEducationSection } from './ProfileEducationSection';
import { ProfileExperienceSection } from './ProfileExperienceSection';
import { ProfileLanguagesSection } from './ProfileLanguagesSection';
import { ProfileOpenToWork, type OpenToWorkConfirmation } from './ProfileOpenToWork';
import { ProfileRecommendationsSection } from './ProfileRecommendationsSection';
import { ProfileSideRail } from './ProfileSideRail';
import { ProfileSkillsSection } from './ProfileSkillsSection';
import { ProfileCertificatesSection, ProfileProjectsSection } from './ProfileTileSections';
import { ProfileTopcard } from './ProfileTopcard';
import type { ProfileTab } from './profileTabs';
import { importedSourceOf, type ImportedSource } from './resumeSourceCoverage';
import { useResumeStudio } from './useResumeStudio';
import { useConsultantSuggestions } from './useConsultantSuggestions';
import type { InlineSuggestionItem } from './InlineConsultantSuggestion';
import type { ResumeDraft, ResumeStudioView } from './resumeTypes';
import type { VacancyProfileRequirementRequest } from '../vacancies/vacancyProfileRequirement';

const ANCHORS: readonly { id: string; label: string }[] = [
  { id: 'sec-about', label: 'Обо мне' },
  { id: 'sec-experience', label: 'Опыт' },
  { id: 'sec-education', label: 'Образование' },
  { id: 'sec-skills', label: 'Навыки' },
  { id: 'sec-certificates', label: 'Сертификаты' },
  { id: 'sec-projects', label: 'Проекты' },
  { id: 'sec-courses', label: 'Курсы' },
  { id: 'sec-languages', label: 'Языки' },
  { id: 'sec-recommendations', label: 'Рекомендации' },
  { id: 'sec-achievements', label: 'Достижения' },
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
      <p>Профиль пока пуст. Импортируйте резюме из LinkedIn или заполните разделы вручную.</p>
    </div>
  );
}

/**
 * "Open to work" regions save through the same workspace write the wizard's
 * region step uses (`routePremises.ts`) — `candidate_workspaces`, not a
 * PATCH-only account column (B265 review round 3, PRB-forbidden ALTER TABLE
 * on the prod DB) — merged into whatever regions the candidate already chose,
 * never overwriting them.
 */
function workspaceWithOpenToWorkRegions(
  workspace: CandidateWorkspace,
  confirmation: OpenToWorkConfirmation,
): CandidateWorkspace {
  const regions = normalizeCandidateRegions([
    ...(workspace.regions ?? []),
    ...confirmation.regions,
  ]);
  return applyRoutePremises(workspace, {
    targetRole: workspace.targetDirection,
    regions,
    workMode: confirmation.workMode,
  });
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
  readonly importedSource?: ImportedSource;
  readonly loading?: boolean;
  readonly saving?: boolean;
  readonly error?: string;
  readonly saveError?: string;
  readonly onRetry: () => void;
  readonly onDraftChange: (draft: ResumeDraft) => void;
  readonly onSectionSave: (next: ResumeDraft) => void;
  /** Opens «Аккаунт → Подключения», where a real re-import starts (B266). */
  readonly onOpenConnections?: () => void;
  /** hh.ru/LinkedIn status chips in the topcard (C54 п.11); undefined while
   *  the read has not landed. */
  readonly connections?: readonly CandidateConnection[];
  readonly onConfirmOpenToWork: (confirmation: OpenToWorkConfirmation) => void;
  readonly confirmingOpenToWork?: boolean;
  readonly suggestions?: readonly InlineSuggestionItem[];
  readonly onAcceptSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly onDismissSuggestion?: (suggestion: InlineSuggestionItem) => void;
  readonly onRevertSuggestion?: (suggestion: InlineSuggestionItem) => Promise<void> | void;
  readonly vacancyRequirement?: VacancyProfileRequirementRequest;
  readonly onVacancyRequirementHandled?: () => void;
  readonly onVacancySuggestionPrepared?: (commandId: string) => Promise<void> | void;
  readonly onManualExperienceFactAdded?: () => Promise<void> | void;
  /**
   * "Профиль / Документ и форматы" now lives in the page header, beside the
   * «Профиль» title, not next to the topcard (owner review round 3) — the
   * cabinet shell owns the tab state and hands the current one down.
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
    onConfirmOpenToWork,
    confirmingOpenToWork,
    tab = 'profile',
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
    <div className="career-profile-screen-view">
      <div className="career-profile-screen-header-row">
        <ProfileTopcard
          draft={draft}
          importedSource={importedSource}
          updatedAt={props.view?.savedAt?.updatedAt}
          reader={props.view?.reader ?? null}
          onDraftChange={onDraftChange}
          connections={connections}
          onOpenConnections={onOpenConnections}
        />
      </div>
      {saveError ? (
        <p className="career-resume-error" role="alert">
          {saveError}
        </p>
      ) : null}
      <ProfileOpenToWork
        candidateId={candidateId}
        draft={draft}
        onConfirm={onConfirmOpenToWork}
        confirming={confirmingOpenToWork}
      />
      {tab === 'documents' ? (
        <ProfileDocumentMenu draft={draft} memory={memory} />
      ) : tab === 'audit' ? (
        <CandidateReputationAuditView candidateId={candidateId} />
      ) : (
        <>
          <ProfileAnchorNav />
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
              <ProfileSkillsSection draft={draft} saving={saving} onSectionSave={onSectionSave} />
              <ProfileCertificatesSection
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
        </>
      )}
    </div>
  );
}

interface ProfileScreenViewProps {
  readonly candidateId: string;
  readonly memory: readonly CandidateMemory[];
  readonly importedSources?: readonly ImportedSourceSummary[];
  readonly onRefreshFacts?: () => void;
  readonly onOpenConnections?: () => void;
  /** Tab state lives in the cabinet shell now — it renders next to the H1. */
  readonly tab?: ProfileTab;
  /**
   * "Open to work" regions save through the same workspace write the wizard's
   * region step uses (`routePremises.ts`) — `candidate_workspaces`, not a
   * PATCH-only account column (B265 review round 3, PRB-forbidden ALTER
   * TABLE on the prod DB).
   */
  readonly workspace?: CandidateWorkspace;
  readonly onUpdateWorkspace?: (workspace: CandidateWorkspace) => void;
  readonly vacancyRequirement?: VacancyProfileRequirementRequest;
  readonly onVacancyRequirementHandled?: () => void;
}

/**
 * The confirm handler alone (workMode PATCH plus the workspace-region write)
 * pulled `ProfileScreenView` past the function-length gate, so it lives in
 * its own hook rather than shrinking the comments that explain either write.
 */
function useConfirmOpenToWork(
  workspace: CandidateWorkspace | undefined,
  onUpdateWorkspace: ((workspace: CandidateWorkspace) => void) | undefined,
) {
  const [confirming, setConfirming] = useState(false);
  const confirm = useCallback(
    async (confirmation: OpenToWorkConfirmation) => {
      setConfirming(true);
      try {
        await updateAccountProfile({ workMode: confirmation.workMode });
        if (workspace && confirmation.regions.length > 0) {
          onUpdateWorkspace?.(workspaceWithOpenToWorkRegions(workspace, confirmation));
        }
      } finally {
        setConfirming(false);
      }
    },
    [workspace, onUpdateWorkspace],
  );
  return { confirming, confirm };
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
    (next: ResumeDraft) => {
      state.setDraft(next);
      state.save(next);
    },
    [state],
  );
}

function useProfileScreenController(props: ProfileScreenViewProps) {
  const { candidateId, onRefreshFacts, workspace, onUpdateWorkspace } = props;
  const state = useResumeStudio(onRefreshFacts);
  const connections = useConnectionStatuses();
  const { confirming: confirmingOtw, confirm: confirmOpenToWork } = useConfirmOpenToWork(
    workspace,
    onUpdateWorkspace,
  );
  const onSectionSave = useSectionSaveHandler(state);
  const reloadResume = state.reload;
  const refreshProfile = useCallback(async () => {
    await reloadResume();
    onRefreshFacts?.();
  }, [onRefreshFacts, reloadResume]);
  const consultant = useConsultantSuggestions(candidateId, refreshProfile);
  return {
    state,
    connections,
    confirmingOtw,
    confirmOpenToWork,
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
  const {
    state,
    connections,
    confirmingOtw,
    confirmOpenToWork,
    onSectionSave,
    refreshProfile,
    consultant,
  } = controller;
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
      onConfirmOpenToWork={(confirmation) => void confirmOpenToWork(confirmation)}
      confirmingOpenToWork={confirmingOtw}
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
