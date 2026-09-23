import { useCallback, useState } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { updateAccountProfile, type CandidateMemory, type ImportedSourceSummary } from '../coach/coachApi';
import { ProfileDocumentMenu } from './ProfileDocumentMenu';
import {
  ProfileAboutSection,
  ProfileEducationSection,
  ProfileExperienceSection,
  ProfileSkillsSection,
} from './ProfileMainSections';
import {
  ProfileAchievementsSection,
  ProfileCertificatesSection,
  ProfileCoursesSection,
  ProfileLanguagesSection,
  ProfileProjectsSection,
  ProfileRecommendationsSection,
} from './ProfileMoreSections';
import { ProfileOpenToWork } from './ProfileOpenToWork';
import { ProfileSideRail } from './ProfileSideRail';
import { ProfileTopcard } from './ProfileTopcard';
import { importedSourceOf, type ImportedSource } from './resumeSourceCoverage';
import { useResumeStudio } from './useResumeStudio';
import type { ResumeDraft, ResumeStudioView } from './resumeTypes';

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
    <nav className="career-profile-anchor-nav" aria-label="Разделы профиля">
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
    <div className="career-profile-state" role="status" aria-live="polite">
      <span className="career-cabinet-skeleton" aria-hidden="true">
        <span className="career-skeleton-line is-wide" />
        <span className="career-skeleton-line" />
        <span className="career-skeleton-line is-short" />
      </span>
      <p>Загружаем профиль…</p>
    </div>
  );
}

function ProfileErrorState({ message, onRetry }: { readonly message?: string; readonly onRetry: () => void }) {
  return (
    <div className="career-profile-state" role="alert">
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
    <div className="career-profile-state">
      <p>Профиль пока пуст. Импортируйте резюме из LinkedIn или заполните разделы вручную.</p>
    </div>
  );
}

function isDraftEmpty(draft: ResumeDraft): boolean {
  return (
    !draft.candidate.fullName?.trim() &&
    !draft.experience.length &&
    !draft.education.length &&
    !(draft.skills?.length ?? 0)
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
  readonly onSave: () => void;
  readonly onRefresh?: () => void;
  readonly onConfirmOpenToWork: (workMode: 'office' | 'hybrid' | 'remote' | 'flexible') => void;
  readonly confirmingOpenToWork?: boolean;
}

/**
 * Presentational surface: every state (loading, error, empty, populated) can
 * be asserted without a network, the same split `ResumeStudioSurface` uses.
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
    onSave,
    onRefresh,
    onConfirmOpenToWork,
    confirmingOpenToWork,
  } = props;

  if (loading) {
    return (
      <div className="career-profile-view">
        <ProfileLoadingState />
      </div>
    );
  }
  if (error || !draft) {
    return (
      <div className="career-profile-view">
        <ProfileErrorState message={error} onRetry={onRetry} />
      </div>
    );
  }
  if (isDraftEmpty(draft)) {
    return (
      <div className="career-profile-view">
        <ProfileEmptyState />
      </div>
    );
  }

  return (
    <div className="career-profile-view">
      <ProfileTopcard
        draft={draft}
        importedSource={importedSource}
        updatedAt={props.view?.savedAt?.updatedAt}
        onDraftChange={onDraftChange}
      />
      <ProfileOpenToWork
        candidateId={candidateId}
        draft={draft}
        onConfirm={onConfirmOpenToWork}
        confirming={confirmingOpenToWork}
      />
      <div className="career-profile-header-actions">
        <ProfileDocumentMenu draft={draft} memory={memory} />
        {saveError ? (
          <span className="career-resume-error" role="alert">
            {saveError}
          </span>
        ) : null}
        <button type="button" className="career-primary-button" disabled={saving} onClick={onSave}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
      <ProfileAnchorNav />
      <div className="career-profile-layout">
        <div className="career-profile-main-col">
          <ProfileAboutSection draft={draft} />
          <ProfileExperienceSection draft={draft} />
          <ProfileEducationSection draft={draft} />
          <ProfileSkillsSection draft={draft} />
          <ProfileCertificatesSection draft={draft} />
          <ProfileProjectsSection draft={draft} />
          <ProfileCoursesSection draft={draft} importedLabel={importedSource?.label} />
          <ProfileLanguagesSection draft={draft} />
          <ProfileRecommendationsSection draft={draft} />
          <ProfileAchievementsSection draft={draft} />
        </div>
        <ProfileSideRail
          draft={draft}
          importedSource={importedSource}
          onRefresh={() => onRefresh?.()}
          refreshing={false}
        />
      </div>
    </div>
  );
}

interface ProfileScreenViewProps {
  readonly candidateId: string;
  readonly memory: readonly CandidateMemory[];
  readonly importedSources?: readonly ImportedSourceSummary[];
  readonly onRefreshFacts?: () => void;
}

/**
 * Connects the candidate-scoped resume API to `ProfileScreenSurface` — the
 * rail's «Профиль» section, replacing Resume Studio wholesale (B265). Uses
 * the same `useResumeStudio` hook Resume Studio does, so a draft saved here
 * and one saved there can never disagree about the wire contract.
 */
export function ProfileScreenView({
  candidateId,
  memory,
  importedSources,
  onRefreshFacts,
}: ProfileScreenViewProps) {
  const state = useResumeStudio(onRefreshFacts);
  const [confirmingOtw, setConfirmingOtw] = useState(false);

  const confirmOpenToWork = useCallback(
    async (workMode: 'office' | 'hybrid' | 'remote' | 'flexible') => {
      setConfirmingOtw(true);
      try {
        await updateAccountProfile({ workMode });
      } finally {
        setConfirmingOtw(false);
      }
    },
    [],
  );

  return (
    <ProfileScreenSurface
      candidateId={candidateId}
      view={state.view}
      draft={state.draft}
      memory={memory}
      importedSource={importedSourceOf(importedSources)}
      loading={state.loading}
      saving={state.saving}
      error={state.error}
      saveError={state.saveError}
      onRetry={state.reload}
      onDraftChange={state.setDraft}
      onSave={state.save}
      onRefresh={onRefreshFacts}
      onConfirmOpenToWork={(mode) => void confirmOpenToWork(mode)}
      confirmingOpenToWork={confirmingOtw}
    />
  );
}
