import { useMemo, useState } from 'react';
import { ArrowRight, Info, Plus, Sparkle } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import { profileCompleteness } from './profileCompleteness';
import { CareerTooltip } from '../shell/CareerTooltip';
import type { CandidateMemory } from '../coach/coachApi';
import { ResumeAtsView } from './ResumeAtsView';
import { ResumePrintAction } from './ResumePrintAction';
import { ResumePrintDocument } from './ResumePrintDocument';
import { orderUnknowns, previewProjection, selectDocument } from './resumeStudioModel';
import type { ResumeDraft, ResumeStudioView, ResumeUnknown } from './resumeTypes';

export interface ProfileReviewAndVersionsProps {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly view?: ResumeStudioView;
  readonly onOpenExpert?: () => void;
  readonly onFillQuestionnaire?: () => void;
  readonly onTabChange?: (tab: 'resume' | 'skills' | 'trace') => void;
  readonly desktopLayout?: boolean;
}

interface TargetedVersion {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
}

const ATS_DIMENSIONS: readonly { readonly label: string; readonly maximum: number }[] = [
  { label: 'Структура', maximum: 25 },
  { label: 'Ключевые слова', maximum: 30 },
  { label: 'Даты', maximum: 20 },
  { label: 'Формат', maximum: 25 },
];

function hasCompleteDates(draft: ResumeDraft): boolean {
  return draft.experience.every((entry) =>
    Boolean(entry.startDate && (entry.current || entry.endDate)),
  );
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

type ReviewBlockId =
  'experience' | 'about' | 'education' | 'projects' | 'languages' | 'confirmations';

interface ReviewBlock {
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

function buildReviewBlocks(
  draft: ResumeDraft,
  issues: readonly ResumeUnknown[],
  staleCount: number,
): ReviewBlock[] {
  const blocks = reviewBlocks(draft, issues);
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
    const firstIssue = issues[0]?.message ?? '';
    return issues.length === 1
      ? firstIssue
      : `${firstIssue} Ещё ${pluralRu(issues.length - 1, ['замечание', 'замечания', 'замечаний'])} в блоке.`;
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
            <span className={`career-profile-screen-review-badge is-${statusKind}`}>{status}</span>
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
): { readonly targetId: string; readonly tab?: 'skills' } {
  const firstMissing = profileCompleteness(draft).missingSections[0];
  if (firstMissing === 'Опыт') return { targetId: 'sec-experience' };
  if (firstMissing === 'Образование') return { targetId: 'sec-education' };
  if (firstMissing === 'Проекты') return { targetId: 'sec-projects' };
  if (firstMissing === 'Языки') return { targetId: 'sec-languages' };
  if (firstMissing === 'Навыки') return { targetId: 'sec-skills', tab: 'skills' };
  if (desktopLayout && firstMissing === 'Курсы') return { targetId: 'sec-courses', tab: 'skills' };
  if (desktopLayout && firstMissing === 'Сертификаты') {
    return { targetId: 'sec-certificates', tab: 'skills' };
  }
  if (desktopLayout && firstMissing === 'Рекомендации') {
    return { targetId: 'sec-recommendations', tab: 'skills' };
  }
  if (desktopLayout && firstMissing === 'Достижения') {
    return { targetId: 'sec-achievements', tab: 'skills' };
  }
  if (firstMissing === 'Курсы') return { targetId: 'sec-courses' };
  if (firstMissing === 'Сертификаты') return { targetId: 'sec-certificates' };
  if (firstMissing === 'Рекомендации') return { targetId: 'sec-recommendations' };
  if (firstMissing === 'Достижения') return { targetId: 'sec-achievements' };
  return { targetId: 'career-profile-screen-topcard' };
}

function QuestionnaireAction({
  draft,
  onFillQuestionnaire,
  onTabChange,
  desktopLayout,
}: {
  readonly draft: ResumeDraft;
  readonly onFillQuestionnaire?: () => void;
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
    onFillQuestionnaire?.();
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
  readonly onFillQuestionnaire?: () => void;
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
      <QuestionnaireAction
        draft={draft}
        onFillQuestionnaire={onFillQuestionnaire}
        onTabChange={onTabChange}
        desktopLayout={desktopLayout}
      />
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
  readonly onFillQuestionnaire?: () => void;
  readonly onTabChange?: (tab: 'resume' | 'skills' | 'trace') => void;
  readonly desktopLayout: boolean;
}) {
  const projection = useMemo(() => previewProjection(draft, memory), [draft, memory]);
  const document = useMemo(() => selectDocument(projection, 'master'), [projection]);
  const issues = distinctReviewIssues(document.unknowns);
  const blocks = buildReviewBlocks(draft, issues, staleCount);
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-quality-card"
      id="sec-check"
      aria-labelledby="sec-check-title"
    >
      <h2 id="sec-check-title">Проверка резюме</h2>
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

function AtsDesktopGuidance() {
  return (
    <>
      <div
        className="career-profile-screen-ats-dimensions"
        role="group"
        aria-label="Категории оценки ATS"
      >
        {ATS_DIMENSIONS.map(({ label, maximum }) => (
          <div className="career-profile-screen-ats-dimension" key={label}>
            <span>{label}</span>
            <span className="career-profile-screen-ats-track" aria-hidden="true" />
            <span className="career-profile-screen-ats-dimension-value">—/{maximum}</span>
          </div>
        ))}
      </div>
      <div className="career-profile-screen-ats-guidance">
        <strong>Что оптимизировать</strong>
        <p>Расчёт для конкретной вакансии не проводился, поэтому оценка неизвестна.</p>
      </div>
      <a className="career-profile-screen-ats-link" href="#sec-documents">
        К резюме и версиям
      </a>
    </>
  );
}

function AtsMobileGuidance() {
  return (
    <>
      <p className="career-profile-screen-quality-note">
        Нет расчёта для конкретной вакансии. Откройте ATS-текст в разделе «Резюме и версии».
      </p>
      <a className="career-profile-screen-ats-link" href="#sec-documents">
        К резюме и версиям
      </a>
    </>
  );
}

function AtsStatusDetails({ desktopLayout }: { readonly desktopLayout: boolean }) {
  return desktopLayout ? <AtsDesktopGuidance /> : <AtsMobileGuidance />;
}

function AtsStatusCard({ desktopLayout }: { readonly desktopLayout: boolean }) {
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-quality-card career-profile-screen-ats-card"
      id="sec-ats"
      aria-labelledby="sec-ats-title"
    >
      <h2 id="sec-ats-title">
        Прохождение ATS
        <CareerTooltip content="Оценка не гарантирует прохождение отбора: системы и настройки работодателей различаются.">
          <button
            className="career-profile-screen-info-button"
            type="button"
            aria-label="Ограничения оценки ATS"
          >
            <Info size={16} aria-hidden="true" />
          </button>
        </CareerTooltip>
      </h2>
      <strong className="career-profile-screen-ats-value">Не рассчитано</strong>
      <AtsStatusDetails desktopLayout={desktopLayout} />
    </section>
  );
}

function dateSummary(draft: ResumeDraft): string {
  const count = draft.experience.length;
  if (!count) return 'Места работы ещё не добавлены.';
  return hasCompleteDates(draft)
    ? `${pluralRu(count, ['место', 'места', 'мест'])}, без пропусков по датам.`
    : 'Проверьте даты начала и окончания мест работы.';
}

function TargetedVersionForm({
  onSubmit,
  onCancel,
}: {
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const inputEl = event.currentTarget.elements.namedItem(
      'targeted-version-input',
    ) as HTMLInputElement | null;
    const finalName = inputEl?.value?.trim() || name.trim();
    if (finalName) onSubmit(finalName);
  };
  return (
    <form className="career-profile-screen-version-form" onSubmit={handleSubmit}>
      <div className="career-profile-screen-form-field">
        <label htmlFor="targeted-version-input" className="career-field-label">
          Название вакансии
        </label>
        <input
          id="targeted-version-input"
          name="targeted-version-input"
          type="text"
          className="career-input"
          data-testid="targeted-version-input"
          placeholder="Например, Вектор Банк"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onInput={(event) => setName((event.target as HTMLInputElement).value)}
        />
      </div>
      <div className="career-profile-screen-form-actions">
        <button
          type="submit"
          className="career-primary-button career-btn-sm"
          data-testid="submit-targeted-version-btn"
        >
          Создать
        </button>
        <button type="button" className="career-secondary-button career-btn-sm" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function TargetedVersionList({ versions }: { readonly versions: readonly TargetedVersion[] }) {
  if (!versions.length) {
    return (
      <p className="career-profile-screen-quality-note">
        Сохранённых снимков резюме под вакансию пока нет.
      </p>
    );
  }
  return (
    <div className="career-profile-screen-targeted-versions">
      {versions.map((version) => (
        <div key={version.id} className="career-profile-screen-versions-row">
          <div>
            <strong>Под вакансию «{version.name}»</strong>
            <p className="career-profile-screen-quality-note">{version.status}</p>
          </div>
          <button type="button" className="career-secondary-button career-btn-sm">
            Открыть
          </button>
        </div>
      ))}
    </div>
  );
}

function ResumeVersionsCardHead({
  isCreating,
  onStartCreate,
}: {
  readonly isCreating: boolean;
  readonly onStartCreate: () => void;
}) {
  return (
    <div className="career-profile-screen-section-head">
      <h2 id="sec-documents-title">Резюме и версии</h2>
      {!isCreating && (
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          data-testid="create-targeted-version-btn"
          onClick={onStartCreate}
        >
          <Plus size={16} aria-hidden="true" />
          <span>Создать версию под вакансию</span>
        </button>
      )}
    </div>
  );
}

function ResumeVersionsCard({
  draft,
  memory,
}: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [versions, setVersions] = useState<readonly TargetedVersion[]>([]);
  const projection = useMemo(() => previewProjection(draft, memory), [draft, memory]);
  const document = useMemo(() => selectDocument(projection, 'master'), [projection]);

  const handleCreate = (name: string) => {
    setVersions((prev) => [
      ...prev,
      {
        id: `ver-${Date.now()}`,
        name,
        status: 'Черновик ждёт вашего одобрения',
        createdAt: new Date().toLocaleDateString('ru-RU'),
      },
    ]);
    setIsCreating(false);
  };

  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section career-profile-screen-versions"
      id="sec-documents"
      aria-labelledby="sec-documents-title"
    >
      <ResumeVersionsCardHead isCreating={isCreating} onStartCreate={() => setIsCreating(true)} />
      <div className="career-profile-screen-versions-row">
        <div>
          <strong>Мастер-резюме</strong>
          <p className="career-profile-screen-quality-note">{dateSummary(draft)}</p>
        </div>
        <ResumePrintAction />
      </div>
      {isCreating ? (
        <TargetedVersionForm onSubmit={handleCreate} onCancel={() => setIsCreating(false)} />
      ) : null}
      <TargetedVersionList versions={versions} />
      <AtsPlainTextDetails document={document} draft={draft} />
      <ResumePrintDocument document={document} draft={draft} />
    </section>
  );
}

function AtsPlainTextDetails({
  document,
  draft,
}: {
  readonly document: ReturnType<typeof selectDocument>;
  readonly draft: ResumeDraft;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="career-profile-screen-ats-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Открыть ATS Plain Text и подготовить целевой срез</summary>
      {open ? <ResumeAtsView document={document} draft={draft} /> : null}
    </details>
  );
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
        <AtsStatusCard desktopLayout={desktopLayout} />
      </div>
      {!desktopLayout ? <ResumeVersionsCard draft={draft} memory={memory} /> : null}
    </>
  );
}

export function ProfileResumeVersions({
  draft,
  memory,
}: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
}) {
  return <ResumeVersionsCard draft={draft} memory={memory} />;
}
