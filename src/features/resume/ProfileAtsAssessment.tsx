import { Info, Lightbulb } from '@phosphor-icons/react';
import type {
  ResumeAtsAssessment,
  ResumeAtsDimension,
} from '../../../server/domain/resumeAtsAssessment';
import type { ResumeVersionSummary } from '../../../server/domain/resumeVersions';
import { CareerTooltip } from '../shell/CareerTooltip';
import { useProfileAtsAssessment } from './useProfileAtsAssessment';
import type { ResumeAtsAssessmentRequest } from './resumeVersionsApi';

export interface ProfileAtsAssessmentProps {
  readonly assessment?: ResumeAtsAssessment | null;
  readonly sourceVersion?: ResumeVersionSummary | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRefresh?: () => void;
  readonly request?: ResumeAtsAssessmentRequest;
  readonly refreshKey?: string | null;
  readonly desktopLayout?: boolean;
  readonly enabled?: boolean;
  readonly id?: string;
}

const ATS_DIMENSIONS = [
  { key: 'structure', label: 'Структура', maximum: 25 },
  { key: 'keywords', label: 'Ключевые слова', maximum: 30 },
  { key: 'dates', label: 'Даты', maximum: 20 },
  { key: 'format', label: 'Формат', maximum: 25 },
] as const;

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'время неизвестно';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'время неизвестно' : date.toLocaleString('ru-RU');
}

function AtsCardHeader({
  titleId,
  assessment,
  sourceVersion,
}: {
  readonly titleId: string;
  readonly assessment: ResumeAtsAssessment | null;
  readonly sourceVersion: ResumeVersionSummary | null;
}) {
  return (
    <h2 id={titleId}>
      Прохождение ATS
      <CareerTooltip
        content={
          <div>
            <p>Оценка основана на проверяемых правилах и не гарантирует решение работодателя.</p>
            <AtsContext assessment={assessment} sourceVersion={sourceVersion} />
            <AtsEvaluationTime assessment={assessment} />
          </div>
        }
      >
        <button
          className="career-quiet-button career-btn-sm career-profile-screen-info-button"
          type="button"
          aria-label="Ограничения оценки ATS"
        >
          <Info size={16} aria-hidden="true" />
        </button>
      </CareerTooltip>
    </h2>
  );
}

function AtsRetryError({
  error,
  onRefresh,
  loading,
}: {
  readonly error: string | null;
  readonly onRefresh: () => void;
  readonly loading: boolean;
}) {
  if (!error) return null;
  return (
    <div className="career-profile-screen-error" role="alert">
      <p>{error}</p>
      <button
        type="button"
        className="career-secondary-button career-btn-sm"
        onClick={onRefresh}
        disabled={loading}
      >
        Повторить
      </button>
    </div>
  );
}

function AtsDimensionRow({
  dimension,
  item,
  assessment,
}: {
  readonly dimension: ResumeAtsDimension | null;
  readonly item: (typeof ATS_DIMENSIONS)[number];
  readonly assessment: ResumeAtsAssessment | null;
}) {
  const ratio = dimension?.score == null ? null : dimension.score / item.maximum;
  const tone =
    ratio === null ? 'is-unknown' : ratio < 0.75 ? 'is-low' : ratio >= 0.85 ? 'is-ok' : '';
  return (
    <details className={`career-profile-screen-ats-dimension ${tone}`}>
      <summary>
        <span>{item.label}</span>
        {ratio === null ? (
          <span className="career-profile-screen-ats-track" aria-hidden="true" />
        ) : (
          <progress
            className="career-profile-screen-ats-track career-profile-screen-ats-fill"
            aria-hidden="true"
            max={item.maximum}
            value={Math.min(item.maximum, Math.max(0, dimension?.score ?? 0))}
          />
        )}
        <span className="career-profile-screen-ats-dimension-value">
          {dimension?.score == null ? `—/${item.maximum}` : `${dimension.score}/${item.maximum}`}
        </span>
      </summary>
      <div className="career-profile-screen-ats-dimension-detail">
        <p className="career-profile-screen-quality-note">
          {dimension?.summary ?? 'Нет подтверждённых данных для расчёта.'}
        </p>
        <p className="career-profile-screen-quality-note">
          {dimension
            ? `Источник: ${dimension.source}; выборка: ${dimension.sampleSize}.`
            : 'Источник данных отсутствует.'}
        </p>
        {item.key === 'keywords' ? <AtsKeywordEvidence assessment={assessment} /> : null}
      </div>
    </details>
  );
}

function AtsDimensions({
  assessment,
  desktopLayout,
}: {
  readonly assessment: ResumeAtsAssessment | null;
  readonly desktopLayout: boolean;
}) {
  return (
    <div
      className="career-profile-screen-ats-dimensions"
      role="group"
      aria-label="Измерения оценки ATS"
      data-layout={desktopLayout ? 'desktop' : 'mobile'}
    >
      {ATS_DIMENSIONS.map((item) => (
        <AtsDimensionRow
          key={item.key}
          item={item}
          dimension={assessment?.dimensions[item.key] ?? null}
          assessment={assessment}
        />
      ))}
    </div>
  );
}

function keywordGuidance(assessment: ResumeAtsAssessment | null): string {
  const requirementSource = assessment?.context.requirementSource;
  if (!requirementSource) {
    return 'Оценка для конкретной вакансии неизвестна. Создайте целевую версию с требованиями, чтобы получить проверяемые совпадения.';
  }
  const missing = assessment?.dimensions.keywords.unmatchedRequirements ?? [];
  if (missing.length) {
    return `Проверьте требования без точного текстового совпадения: ${missing.join(', ')}.`;
  }
  return assessment?.dimensions.keywords.summary ?? 'Проверьте исходные данные и текст резюме.';
}

function AtsContext({
  assessment,
  sourceVersion,
}: {
  readonly assessment: ResumeAtsAssessment | null;
  readonly sourceVersion: ResumeVersionSummary | null;
}) {
  const source = assessment?.context.requirementSource;
  if (!source && !sourceVersion) return null;
  const label = sourceVersion
    ? `Снимок «${sourceVersion.title}» · редакция ${sourceVersion.revision}`
    : `${source?.label} · источник ${source?.kind}`;
  return (
    <p className="career-profile-screen-quality-note">
      Контекст: {label}
      {source ? ` · требования сохранены ${formatTimestamp(source.capturedAt)}` : ''}.
    </p>
  );
}

function AtsEvaluationTime({ assessment }: { readonly assessment: ResumeAtsAssessment | null }) {
  if (!assessment) return null;
  return (
    <p className="career-profile-screen-quality-note">
      Резюме обновлено:{' '}
      {assessment.context.resumeUpdatedAt
        ? formatTimestamp(assessment.context.resumeUpdatedAt)
        : 'снимок версии сохранён'}
      . Оценка рассчитана {formatTimestamp(assessment.evaluatedAt)}.
    </p>
  );
}

function AtsKeywordEvidence({ assessment }: { readonly assessment: ResumeAtsAssessment | null }) {
  const evidence = assessment?.dimensions.keywords.evidence ?? [];
  if (!evidence.length) return null;
  return (
    <div className="career-profile-screen-quality-note">
      <strong>Точные совпадения с требованиями</strong>
      <ul>
        {evidence.map((item, index) => (
          <li key={`${item.requirement}-${index}`}>
            <span>{item.requirement}: </span>
            {item.matches.length
              ? item.matches.map((match) => `${match.field} — «${match.text}»`).join('; ')
              : 'совпадений нет'}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AtsGuidance({ assessment }: { readonly assessment: ResumeAtsAssessment | null }) {
  return (
    <>
      <div className="career-profile-screen-ats-guidance">
        <Lightbulb size="1em" aria-hidden="true" />
        <p>
          <strong>Что оптимизировать:</strong> {keywordGuidance(assessment)}
        </p>
      </div>
    </>
  );
}

function useAtsCardState(props: ProfileAtsAssessmentProps) {
  const {
    assessment: suppliedAssessment,
    sourceVersion: suppliedSourceVersion,
    loading: suppliedLoading,
    error: suppliedError,
    onRefresh,
    request,
    refreshKey,
    enabled,
  } = props;
  const internal = useProfileAtsAssessment({
    enabled: enabled ?? suppliedAssessment === undefined,
    request,
    refreshKey,
  });
  const assessment = suppliedAssessment === undefined ? internal.assessment : suppliedAssessment;
  const sourceVersion = suppliedSourceVersion ?? internal.sourceVersion;
  const loading = suppliedLoading ?? internal.loading;
  const error = suppliedError ?? internal.error;
  const refresh = onRefresh ?? internal.refresh;
  const score = assessment?.total.score ?? null;
  const ariaLabel = loading
    ? 'Оценка ATS рассчитывается'
    : score === null
      ? 'Оценка ATS неизвестна'
      : `Оценка ATS ${score} из 100`;
  return { assessment, sourceVersion, loading, error, refresh, score, ariaLabel };
}

export function ProfileAtsAssessment(props: ProfileAtsAssessmentProps) {
  const { id = 'sec-ats', desktopLayout = false } = props;
  const { assessment, sourceVersion, loading, error, refresh, score, ariaLabel } =
    useAtsCardState(props);
  return (
    <section
      className="career-profile-screen-panel career-profile-screen-quality-card career-profile-screen-ats-card"
      id={id}
      aria-labelledby={`${id}-title`}
      data-assessment-status={assessment?.total.status ?? 'unknown'}
    >
      <AtsCardHeader
        titleId={`${id}-title`}
        assessment={assessment}
        sourceVersion={sourceVersion}
      />
      <div className="career-profile-screen-ats-score">
        <strong
          className="career-profile-screen-ats-value"
          aria-live="polite"
          aria-label={ariaLabel}
        >
          {loading ? '…' : (score ?? '—')}
        </strong>
        <span className="career-profile-screen-ats-unit">из 100</span>
      </div>
      <AtsRetryError error={error} onRefresh={refresh} loading={loading} />
      <AtsDimensions assessment={assessment} desktopLayout={desktopLayout} />
      <AtsGuidance assessment={assessment} />
    </section>
  );
}
