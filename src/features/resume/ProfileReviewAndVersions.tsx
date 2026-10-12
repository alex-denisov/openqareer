import { useMemo, useState } from 'react';
import { ArrowRight, Info, Plus, Sparkle } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
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
}

interface TargetedVersion {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
}

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

function ReviewActions({
  onOpenExpert,
  onFillQuestionnaire,
}: {
  readonly onOpenExpert?: () => void;
  readonly onFillQuestionnaire?: () => void;
}) {
  const handleQuestionnaire = () => {
    if (onFillQuestionnaire) {
      onFillQuestionnaire();
    }
  };

  return (
    <div className="career-profile-screen-review-actions">
      {onOpenExpert ? (
        <button
          type="button"
          className="career-primary-button"
          data-testid="review-fix-with-consultant-btn"
          aria-label="Исправить вместе с консультантом: Собрать факты с консультантом"
          onClick={onOpenExpert}
        >
          <Sparkle size={16} aria-hidden="true" />
          <span>Исправить вместе с консультантом</span>
        </button>
      ) : null}
      <button
        type="button"
        className="career-secondary-button"
        data-testid="review-fill-questionnaire-btn"
        onClick={handleQuestionnaire}
      >
        <ArrowRight size={16} aria-hidden="true" />
        <span>Заполнить анкету</span>
      </button>
    </div>
  );
}

function ResumeReviewCard({
  draft,
  memory,
  staleCount,
  onOpenExpert,
  onFillQuestionnaire,
}: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly staleCount: number;
  readonly onOpenExpert?: () => void;
  readonly onFillQuestionnaire?: () => void;
}) {
  const projection = useMemo(() => previewProjection(draft, memory), [draft, memory]);
  const document = useMemo(() => selectDocument(projection, 'master'), [projection]);
  const issues = Array.from(
    new Map(
      orderUnknowns(document.unknowns).map((issue) => [`${issue.code}:${issue.message}`, issue]),
    ).values(),
  ).slice(0, 4);
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-quality-card"
      id="sec-check"
      aria-labelledby="sec-check-title"
    >
      <h2 id="sec-check-title">Проверка резюме</h2>
      <p className="career-profile-screen-quality-summary">
        {issues.length || staleCount
          ? `Открытые вопросы по блокам: ${document.unknowns.length + staleCount}.`
          : 'В текущей версии не осталось открытых вопросов по структуре.'}
      </p>
      <ReviewIssueList issues={issues} />
      {staleCount ? (
        <p className="career-profile-screen-quality-note">
          Устаревшие подтверждения: {staleCount}.
        </p>
      ) : null}
      <ReviewActions onOpenExpert={onOpenExpert} onFillQuestionnaire={onFillQuestionnaire} />
    </section>
  );
}

function AtsStatusCard() {
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
      <p className="career-profile-screen-quality-note">
        Нет расчёта для конкретной вакансии. Откройте ATS-текст в разделе «Резюме и версии».
      </p>
      <a className="career-profile-screen-ats-link" href="#sec-documents">
        К резюме и версиям
      </a>
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
      <ResumeVersionsCardHead
        isCreating={isCreating}
        onStartCreate={() => setIsCreating(true)}
      />
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
  const { draft, memory, view, onOpenExpert, onFillQuestionnaire } = props;
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
        />
        <AtsStatusCard />
      </div>
      <ResumeVersionsCard draft={draft} memory={memory} />
    </>
  );
}
