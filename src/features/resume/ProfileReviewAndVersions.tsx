import { useMemo, useState } from 'react';
import { Info } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import { CareerTooltip } from '../shell/CareerTooltip';
import type { CandidateMemory } from '../coach/coachApi';
import { ResumeAtsView } from './ResumeAtsView';
import { ResumePrintAction } from './ResumePrintAction';
import { ResumePrintDocument } from './ResumePrintDocument';
import { orderUnknowns, previewProjection, selectDocument } from './resumeStudioModel';
import type { ResumeDraft, ResumeStudioView, ResumeUnknown } from './resumeTypes';

interface ProfileReviewAndVersionsProps {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly view?: ResumeStudioView;
  readonly onOpenExpert?: () => void;
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

function ResumeReviewCard({
  draft,
  memory,
  staleCount,
  onOpenExpert,
}: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
  readonly staleCount: number;
  readonly onOpenExpert?: () => void;
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
      {onOpenExpert ? (
        <button type="button" className="career-primary-button" onClick={onOpenExpert}>
          Собрать факты с консультантом
        </button>
      ) : null}
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

function ResumeVersionsCard({
  draft,
  memory,
}: {
  readonly draft: ResumeDraft;
  readonly memory: readonly CandidateMemory[];
}) {
  const projection = useMemo(() => previewProjection(draft, memory), [draft, memory]);
  const document = useMemo(() => selectDocument(projection, 'master'), [projection]);
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-section career-profile-screen-versions"
      id="sec-documents"
      aria-labelledby="sec-documents-title"
    >
      <div className="career-profile-screen-section-head">
        <h2 id="sec-documents-title">Резюме и версии</h2>
      </div>
      <div className="career-profile-screen-versions-row">
        <div>
          <strong>Мастер-резюме</strong>
          <p className="career-profile-screen-quality-note">{dateSummary(draft)}</p>
        </div>
        <ResumePrintAction />
      </div>
      <p className="career-profile-screen-quality-note">
        Сохранённых снимков резюме под вакансию пока нет.
      </p>
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
  const { draft, memory, view, onOpenExpert } = props;
  const staleCount = view?.evidenceFreshness?.stale?.length ?? 0;
  return (
    <>
      <div className="career-profile-screen-review-grid">
        <ResumeReviewCard
          draft={draft}
          memory={memory}
          staleCount={staleCount}
          onOpenExpert={onOpenExpert}
        />
        <AtsStatusCard />
      </div>
      <ResumeVersionsCard draft={draft} memory={memory} />
    </>
  );
}
