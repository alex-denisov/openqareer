import { useMemo } from 'react';
import { ArrowRight, Sparkle, CheckCircle, Question, Warning, Info } from '@phosphor-icons/react';
import { CareerTooltip } from '../shell/CareerTooltip';
import { pluralRu } from '../../../shared/pluralRu';
import { profileCompleteness } from './profileCompleteness';
import type { CandidateMemory } from '../coach/coachApi';
import { aboutFinding, experienceFinding, experienceFindingCount } from './reviewFindings';
import { orderUnknowns, previewProjection, selectDocument } from './resumeStudioModel';
import {
  ProfileAtsAssessment as ProfileAtsAssessmentContent,
  type ProfileAtsAssessmentProps,
} from './ProfileAtsAssessment';
import { ProfileResumeVersions as ProfileResumeVersionsContent } from './ProfileResumeVersions';
export type { ProfileAtsAssessmentProps } from './ProfileAtsAssessment';
import type { ResumeDraft, ResumeStudioView, ResumeUnknown } from './resumeTypes';

export interface ProfileReviewAndVersionsProps {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly view?: ResumeStudioView;
  readonly onOpenExpert?: () => void;
  readonly onFillQuestionnaire?: (sectionTitle: string) => void;
  readonly onTabChange?: (tab: 'resume' | 'skills' | 'trace') => void;
  readonly desktopLayout?: boolean;
}

function ReviewIssueList({ issues }: { readonly issues: readonly ResumeUnknown[] }) {
  if (!issues.length) {
    return (
      <p className="career-profile-screen-quality-note">Проверьте содержание перед отправкой.</p>
    );
  }
  return (
    <ul className="career-profile-screen-quality-list">
      {issues.map((issue) => (
        <li key={`${issue.code}-${issue.entryId ?? 'profile'}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

export type ReviewBlockId =
  'experience' | 'about' | 'education' | 'projects' | 'languages' | 'confirmations';

export interface ReviewBlock {
  readonly id: ReviewBlockId;
  readonly label: string;
  readonly issues: readonly ResumeUnknown[];
  readonly hasData: boolean;
  readonly issueCount?: number;
  readonly description?: string;
}

function reviewBlockForIssue(issue: ResumeUnknown, draft: ResumeDraft): ReviewBlockId {
  if (issue.entryId && draft.experience.some((entry) => entry.id === issue.entryId)) {
    return 'experience';
  }
  if (issue.entryId && draft.education.some((entry) => entry.id === issue.entryId)) {
    return 'education';
  }
  if (issue.entryId && draft.languages.some((entry) => entry.id === issue.entryId)) {
    return 'languages';
  }
  if (issue.entryId && draft.projects?.some((entry) => entry.id === issue.entryId)) {
    return 'projects';
  }

  switch (issue.code) {
    case 'missing-role-chronology':
    case 'missing-role-title':
    case 'missing-employer':
    case 'missing-role-start-date':
    case 'missing-role-end-date':
    case 'missing-role-claims':
    case 'chronology-conflict':
    case 'invalid-chronology-date':
      return 'experience';
    case 'missing-education':
    case 'missing-education-details':
      return 'education';
    case 'missing-language-name':
    case 'missing-language-level':
      return 'languages';
    case 'missing-full-name':
    case 'missing-contact':
    case 'missing-target-role':
    case 'ineligible-evidence':
    case 'germany-bullet-count':
    case 'germany-length-exceeds-two-pages':
      return 'about';
    default:
      return 'about';
  }
}

function reviewBlocks(draft: ResumeDraft, issues: readonly ResumeUnknown[]): ReviewBlock[] {
  const grouped = new Map<ReviewBlockId, ResumeUnknown[]>();
  for (const issue of issues) {
    const id = reviewBlockForIssue(issue, draft);
    grouped.set(id, [...(grouped.get(id) ?? []), issue]);
  }
  const blocks: ReviewBlock[] = [
    {
      id: 'experience',
      label: 'Опыт',
      issues: grouped.get('experience') ?? [],
      hasData: draft.experience.length > 0,
    },
    {
      id: 'about',
      label: 'Обо мне',
      issues: grouped.get('about') ?? [],
      hasData: Boolean(draft.candidate.about?.trim()),
    },
    {
      id: 'education',
      label: 'Образование',
      issues: grouped.get('education') ?? [],
      hasData: draft.education.length > 0,
    },
  ];
  for (const optionalBlock of [
    {
      id: 'projects' as const,
      label: 'Проекты',
      hasData: Boolean(draft.projects?.length),
    },
    {
      id: 'languages' as const,
      label: 'Языки',
      hasData: draft.languages.length > 0,
    },
  ]) {
    const blockIssues = grouped.get(optionalBlock.id) ?? [];
    if (blockIssues.length) {
      blocks.push({ ...optionalBlock, issues: blockIssues });
    }
  }
  return blocks;
}

function withFindings(
  blocks: ReviewBlock[],
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
): ReviewBlock[] {
  const findings: Partial<Record<ReviewBlockId, string | undefined>> = {
    experience: experienceFinding(draft, memory),
    about: aboutFinding(draft.candidate.about),
  };
  return blocks.map((block) => {
    const description = findings[block.id];
    const described = description && !block.description ? { ...block, description } : block;
    const extra = block.id === 'experience' ? experienceFindingCount(draft) : 0;
    return extra
      ? { ...described, issueCount: actionableIssues(described).length + extra }
      : described;
  });
}

function buildReviewBlocks(
  draft: ResumeDraft,
  issues: readonly ResumeUnknown[],
  staleCount: number,
  memory: readonly CandidateMemory[],
): ReviewBlock[] {
  const blocks = withFindings(reviewBlocks(draft, issues), draft, memory);
  if (staleCount) {
    blocks.push({
      id: 'confirmations',
      label: 'Подтверждения',
      issues: [],
      hasData: true,
      issueCount: staleCount,
      description: `${pluralRu(staleCount, [
        'устаревшее подтверждение',
        'устаревших подтверждения',
        'устаревших подтверждений',
      ])} ${staleCount === 1 ? 'требует' : 'требуют'} проверки.`,
    });
  }
  return blocks;
}

function distinctReviewIssues(issues: readonly ResumeUnknown[]): ResumeUnknown[] {
  return Array.from(
    new Map(
      orderUnknowns(issues).map((issue) => [
        `${issue.code}:${issue.entryId ?? 'profile'}:${issue.memoryId ?? ''}:${issue.message}`,
        issue,
      ]),
    ).values(),
  );
}

/** Returns the saved master's deduplicated review issue count when loaded. */
export function profileResumeReviewIssueCount(
  view?: ResumeStudioView,
  draft?: Pick<ResumeDraft, 'experience'>,
): number | undefined {
  if (!view) return undefined;
  const findings = draft ? experienceFindingCount(draft) : 0;
  return distinctReviewIssues(selectDocument(view.projection, 'master').unknowns).length + findings;
}

/** Uses the same master-document review projection and block rules as the Review card. */
export function profileResumeReviewBlocks(
  view: ResumeStudioView | undefined,
  draft: ResumeDraft,
  memory: readonly CandidateMemory[] = [],
): ReviewBlock[] {
  const projection = previewProjection(draft, memory);
  const document = selectDocument(projection, 'master');
  const issues = distinctReviewIssues(document.unknowns);
  const staleCount = view?.evidenceFreshness.stale.length ?? 0;
  return buildReviewBlocks(draft, issues, staleCount, memory);
}

function actionableIssues(block: ReviewBlock): readonly ResumeUnknown[] {
  return block.issues.filter((issue) => {
    if (issue.code === 'missing-role-chronology' && !block.hasData) return false;
    if (issue.code === 'missing-education' && !block.hasData) return false;
    if (issue.code === 'missing-language-level' && !block.hasData) return false;
    return true;
  });
}

function reviewStatus(block: ReviewBlock): string {
  const count = block.issueCount ?? actionableIssues(block).length;
  if (count) return pluralRu(count, ['замечание', 'замечания', 'замечаний']);
  return block.hasData ? 'Замечаний нет' : 'Неизвестно';
}

function reviewDescription(block: ReviewBlock): string {
  if (block.description) return block.description;
  const issues = actionableIssues(block);
  if (issues.length) {
    return issues[0]?.message ?? '';
  }
  return block.hasData
    ? 'В этом блоке сейчас нет замечаний.'
    : 'Нет данных, чтобы проверить этот блок.';
}

function ReviewBlockRows({ blocks }: { readonly blocks: readonly ReviewBlock[] }) {
  return (
    <div className="career-profile-screen-review-rows">
      {blocks.map((block) => {
        const status = reviewStatus(block);
        const statusKind =
          status === 'Замечаний нет' ? 'clear' : status === 'Неизвестно' ? 'unknown' : 'issues';
        return (
          <div className="career-profile-screen-review-row" key={block.id}>
            <div className="career-profile-screen-review-copy">
              <strong>{block.label}</strong>
              <p>{reviewDescription(block)}</p>
            </div>
            <span className={`career-profile-screen-review-badge is-${statusKind}`}>
              {statusKind === 'clear' ? (
                <CheckCircle size={14} aria-hidden="true" />
              ) : statusKind === 'unknown' ? (
                <Question size={14} aria-hidden="true" />
              ) : (
                <Warning size={14} aria-hidden="true" />
              )}
              {status}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function focusElement(targetId: string): void {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  const focusTarget =
    target.querySelector<HTMLElement>('button, input, select, textarea, a[href]') ?? target;
  if (!focusTarget.matches('button, input, select, textarea, a[href], [tabindex]')) {
    focusTarget.tabIndex = -1;
  }
  focusTarget.focus({ preventScroll: true });
}

function questionnaireTarget(
  draft: ResumeDraft,
  desktopLayout: boolean,
): { readonly targetId: string; readonly sectionTitle: string; readonly tab?: 'skills' } {
  const sectionTitle = profileCompleteness(draft).missingSections[0] ?? 'Профиль';
  if (sectionTitle === 'Опыт') return { targetId: 'sec-experience', sectionTitle };
  if (sectionTitle === 'Образование') return { targetId: 'sec-education', sectionTitle };
  if (sectionTitle === 'Проекты') return { targetId: 'sec-projects', sectionTitle };
  if (sectionTitle === 'Языки') return { targetId: 'sec-languages', sectionTitle };
  if (sectionTitle === 'Навыки') return { targetId: 'sec-skills', sectionTitle, tab: 'skills' };
  if (desktopLayout && sectionTitle === 'Курсы') {
    return { targetId: 'sec-courses', sectionTitle, tab: 'skills' };
  }
  if (desktopLayout && sectionTitle === 'Сертификаты') {
    return { targetId: 'sec-certificates', sectionTitle, tab: 'skills' };
  }
  if (desktopLayout && sectionTitle === 'Рекомендации') {
    return { targetId: 'sec-recommendations', sectionTitle, tab: 'skills' };
  }
  if (desktopLayout && sectionTitle === 'Достижения') {
    return { targetId: 'sec-achievements', sectionTitle, tab: 'skills' };
  }
  if (sectionTitle === 'Курсы') return { targetId: 'sec-courses', sectionTitle };
  if (sectionTitle === 'Сертификаты') return { targetId: 'sec-certificates', sectionTitle };
  if (sectionTitle === 'Рекомендации') return { targetId: 'sec-recommendations', sectionTitle };
  if (sectionTitle === 'Достижения') return { targetId: 'sec-achievements', sectionTitle };
  return { targetId: 'career-profile-screen-topcard', sectionTitle };
}

function QuestionnaireAction({
  draft,
  onFillQuestionnaire,
  onTabChange,
  desktopLayout,
}: {
  readonly draft: ResumeDraft;
  readonly onFillQuestionnaire?: (sectionTitle: string) => void;
  readonly onTabChange?: (tab: 'resume' | 'skills' | 'trace') => void;
  readonly desktopLayout: boolean;
}) {
  const handleQuestionnaire = () => {
    const target = questionnaireTarget(draft, desktopLayout);
    if (target.tab) {
      if (onTabChange) {
        onTabChange(target.tab);
        requestAnimationFrame(() => {
          if (document.getElementById(target.targetId)) focusElement(target.targetId);
          else focusElement('profile-tab-skills');
        });
      } else {
        focusElement('profile-tab-skills');
      }
    } else {
      focusElement(target.targetId);
    }
    onFillQuestionnaire?.(target.sectionTitle);
  };

  return (
    <button
      type="button"
      className={
        desktopLayout
          ? 'career-quiet-button career-profile-screen-questionnaire-button'
          : 'career-secondary-button'
      }
      data-testid="review-fill-questionnaire-btn"
      onClick={handleQuestionnaire}
    >
      <ArrowRight size={16} aria-hidden="true" />
      <span>Заполнить анкету</span>
    </button>
  );
}

function ReviewActions({
  draft,
  onOpenExpert,
  onFillQuestionnaire,
  onTabChange,
  desktopLayout,
}: {
  readonly draft: ResumeDraft;
  readonly onOpenExpert?: () => void;
  readonly onFillQuestionnaire?: (sectionTitle: string) => void;
  readonly onTabChange?: (tab: 'resume' | 'skills' | 'trace') => void;
  readonly desktopLayout: boolean;
}) {
  return (
    <div className="career-profile-screen-review-actions">
      {onOpenExpert ? (
        <button
          type="button"
          className="career-primary-button"
          data-testid="review-fix-with-consultant-btn"
          aria-label="Собрать факты с консультантом"
          onClick={onOpenExpert}
        >
          <Sparkle size={16} aria-hidden="true" />
          <span>Собрать факты с консультантом</span>
        </button>
      ) : null}
      {/* The approved 1440 mockup keeps one action here; the questionnaire stays on 390. */}
      {desktopLayout && onOpenExpert ? null : (
        <QuestionnaireAction
          draft={draft}
          onFillQuestionnaire={onFillQuestionnaire}
          onTabChange={onTabChange}
          desktopLayout={desktopLayout}
        />
      )}
    </div>
  );
}

function MobileReviewSummary({
  issueCount,
  unknownCount,
  staleCount,
}: {
  readonly issueCount: number;
  readonly unknownCount: number;
  readonly staleCount: number;
}) {
  return (
    <p className="career-profile-screen-quality-summary">
      {issueCount || staleCount
        ? `Открытые вопросы по блокам: ${unknownCount + staleCount}.`
        : 'В текущей версии не осталось открытых вопросов по структуре.'}
    </p>
  );
}

function ResumeReviewContent({
  desktopLayout,
  blocks,
  issues,
  unknownCount,
  staleCount,
}: {
  readonly desktopLayout: boolean;
  readonly blocks: readonly ReviewBlock[];
  readonly issues: readonly ResumeUnknown[];
  readonly unknownCount: number;
  readonly staleCount: number;
}) {
  if (desktopLayout) return <ReviewBlockRows blocks={blocks} />;
  return (
    <>
      <MobileReviewSummary
        issueCount={issues.length}
        unknownCount={unknownCount}
        staleCount={staleCount}
      />
      <ReviewIssueList issues={issues.slice(0, 4)} />
      {staleCount ? (
        <p className="career-profile-screen-quality-note">
          Устаревшие подтверждения: {staleCount}.
        </p>
      ) : null}
    </>
  );
}

function ResumeReviewHeader() {
  return (
    <h2 id="sec-check-title">
      Проверка резюме
      <CareerTooltip content="Читаемость: длина, цифры, структура. Корректность: совпадение источников и непроверенные факты.">
        <button
          type="button"
          className="career-quiet-button career-btn-sm career-profile-screen-info-button"
          aria-label="Пояснение проверки резюме"
        >
          <Info size={16} aria-hidden="true" />
        </button>
      </CareerTooltip>
    </h2>
  );
}

function ResumeReviewCard({
  draft,
  memory,
  staleCount,
  onOpenExpert,
  onFillQuestionnaire,
  onTabChange,
  desktopLayout,
}: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly staleCount: number;
  readonly onOpenExpert?: () => void;
  readonly onFillQuestionnaire?: (sectionTitle: string) => void;
  readonly onTabChange?: (tab: 'resume' | 'skills' | 'trace') => void;
  readonly desktopLayout: boolean;
}) {
  const projection = useMemo(() => previewProjection(draft, memory), [draft, memory]);
  const document = useMemo(() => selectDocument(projection, 'master'), [projection]);
  const issues = distinctReviewIssues(document.unknowns);
  const blocks = buildReviewBlocks(draft, issues, staleCount, memory);
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-quality-card"
      id="sec-check"
      aria-labelledby="sec-check-title"
    >
      <ResumeReviewHeader />
      <ResumeReviewContent
        desktopLayout={desktopLayout}
        blocks={blocks}
        issues={issues}
        unknownCount={document.unknowns.length}
        staleCount={staleCount}
      />
      <ReviewActions
        draft={draft}
        onOpenExpert={onOpenExpert}
        onFillQuestionnaire={onFillQuestionnaire}
        onTabChange={onTabChange}
        desktopLayout={desktopLayout}
      />
    </section>
  );
}

export function ProfileResumeReview(props: ProfileReviewAndVersionsProps) {
  const staleCount = props.view?.evidenceFreshness?.stale?.length ?? 0;
  return (
    <ResumeReviewCard
      draft={props.draft}
      memory={props.memory}
      staleCount={staleCount}
      onOpenExpert={props.onOpenExpert}
      onFillQuestionnaire={props.onFillQuestionnaire}
      onTabChange={props.onTabChange}
      desktopLayout={props.desktopLayout ?? false}
    />
  );
}

export function ProfileAtsAssessment(props: ProfileAtsAssessmentProps) {
  return <ProfileAtsAssessmentContent {...props} />;
}

export function ProfileReviewAndVersions(props: ProfileReviewAndVersionsProps) {
  const {
    draft,
    memory,
    view,
    onOpenExpert,
    onFillQuestionnaire,
    onTabChange,
    desktopLayout = false,
  } = props;
  const staleCount = view?.evidenceFreshness?.stale?.length ?? 0;
  return (
    <>
      <div className="career-profile-screen-review-grid">
        <ResumeReviewCard
          draft={draft}
          memory={memory}
          staleCount={staleCount}
          onOpenExpert={onOpenExpert}
          onFillQuestionnaire={onFillQuestionnaire}
          onTabChange={onTabChange}
          desktopLayout={desktopLayout}
        />
        <ProfileAtsAssessment desktopLayout={desktopLayout} enabled={Boolean(view)} />
      </div>
      {!desktopLayout && view ? (
        <ProfileResumeVersions draft={draft} memory={memory} view={view} />
      ) : null}
    </>
  );
}

export function ProfileResumeVersions(props: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly view?: ResumeStudioView;
}) {
  return <ProfileResumeVersionsContent {...props} />;
}
