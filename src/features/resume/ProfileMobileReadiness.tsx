import { Info, Sparkle } from '@phosphor-icons/react';
import type { ResumeAtsDimension } from '../../../server/domain/resumeAtsAssessment';
import type { ProfileAtsAssessmentState } from './useProfileAtsAssessment';
import { ATS_ROLE_BASIS_NOTE } from './atsRoleBasis';
import type { ProfileMobileDataProps } from './profileMobileTypes';

function ScoreRing({
  score,
  maximum,
}: {
  readonly score: number | null;
  readonly maximum: number;
}) {
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="pm-cat-r">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity=".14"
          strokeWidth="6"
        />
        {score === null ? null : (
          <circle
            cx="28"
            cy="28"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(circumference * score) / maximum} ${circumference}`}
            transform="rotate(-90 28 28)"
          />
        )}
      </svg>
      <b className="num">{score ?? '—'}</b>
    </span>
  );
}

function ScoreGauge({ score }: { readonly score: number | null }) {
  const circumference = 2 * Math.PI * 84;
  const arc = circumference * 0.75;
  return (
    <div
      className="pm-gauge"
      role="img"
      aria-label={score === null ? 'Оценка ATS неизвестна' : `${score} из 100`}
    >
      <svg viewBox="0 0 200 170" aria-hidden="true">
        <g transform="rotate(135 100 100)">
          <circle
            cx="100"
            cy="100"
            r="84"
            fill="none"
            stroke="currentColor"
            strokeOpacity=".12"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
          />
          {score === null ? null : (
            <circle
              cx="100"
              cy="100"
              r="84"
              fill="none"
              className="profile-mobile-gauge-value"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${(arc * score) / 100} ${circumference}`}
            />
          )}
        </g>
      </svg>
      <div className="pm-gauge-v">
        <span className="num">{score ?? '—'}</span>
        <small>из 100</small>
      </div>
    </div>
  );
}

const DIMENSIONS = [
  ['structure', 'Структура', 25],
  ['keywords', 'Ключевые слова', 30],
  ['dates', 'Даты', 20],
  ['format', 'Формат', 25],
] as const;

function AtsCategories({ assessment }: Pick<ProfileAtsAssessmentState, 'assessment'>) {
  return (
    <div className="pm-cats">
      {DIMENSIONS.map(([key, name, maximum]) => {
        const score = assessment?.dimensions[key].score ?? null;
        const low = score !== null && score / maximum < 0.75;
        return (
          <div
            key={key}
            className={`pm-cat${low ? ' is-low' : ''}${score === null ? ' is-unknown' : ''}`}
          >
            <ScoreRing score={score} maximum={maximum} />
            <span className="pm-cat-n">{name}</span>
            <small className="num">из {maximum}</small>
          </div>
        );
      })}
    </div>
  );
}

function dimensionGuidance(dimension: ResumeAtsDimension): string | undefined {
  return dimension.score === null || dimension.score < dimension.maximum
    ? dimension.summary
    : undefined;
}

function AtsGuidance({ assessment }: Pick<ProfileAtsAssessmentState, 'assessment'>) {
  const items = DIMENSIONS.flatMap(([key, name]) => {
    const dimension = assessment?.dimensions[key];
    const guidance = dimension ? dimensionGuidance(dimension) : undefined;
    return guidance ? [{ key, name, guidance }] : [];
  });
  if (!items.length) return null;
  return (
    <section className="pm-group">
      <h3 className="pm-cap">Что исправить</h3>
      <div className="pm-list">
        {items.map((item) => (
          <div className="pm-bul" key={item.key}>
            <b>{item.name}</b>
            <p className="profile-mobile-ats-guidance">{item.guidance}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AtsContext({
  assessment,
  sourceVersion,
}: Pick<ProfileAtsAssessmentState, 'assessment' | 'sourceVersion'>) {
  const updated = assessment?.context.resumeUpdatedAt;
  const source = assessment?.context.requirementSource;
  return (
    <p className="pm-foot">
      {sourceVersion ? `Версия «${sourceVersion.title}». ` : 'Мастер-резюме. '}
      {updated
        ? `Обновлено ${new Date(updated).toLocaleString('ru-RU')}. `
        : 'Время обновления не подтверждено. '}
      {source ? `Требования: ${source.label}.` : 'Проверенных требований вакансии для расчёта нет.'}
    </p>
  );
}

export function ProfileMobileAts(
  props: ProfileMobileDataProps & { readonly ats: ProfileAtsAssessmentState },
) {
  const { ats } = props;
  const discuss = props.onFillQuestionnaire
    ? () => props.onFillQuestionnaire?.('ATS и требования вакансии')
    : props.onOpenExpert;
  return (
    <>
      <ScoreGauge score={ats.assessment?.total.score ?? null} />
      {ats.roleBasis ? (
        <div className="pm-tip">
          <Info size="1em" aria-hidden="true" />
          <span>{ATS_ROLE_BASIS_NOTE}</span>
        </div>
      ) : null}
      {ats.loading ? (
        <p className="pm-note" role="status">
          Считаем оценку по данным резюме…
        </p>
      ) : null}
      {ats.error ? (
        <div className="pm-tip" role="alert">
          <Info size="1em" aria-hidden="true" />
          <span>
            {ats.error}
            <button type="button" className="pm-text" onClick={ats.refresh}>
              Повторить
            </button>
          </span>
        </div>
      ) : null}
      <AtsCategories assessment={ats.assessment} />
      <AtsGuidance assessment={ats.assessment} />
      <button type="button" className="pm-cta" disabled={!discuss} onClick={discuss}>
        <Sparkle size="1em" aria-hidden="true" />
        Исправить вместе с консультантом
      </button>
      <AtsContext assessment={ats.assessment} sourceVersion={ats.sourceVersion} />
    </>
  );
}
