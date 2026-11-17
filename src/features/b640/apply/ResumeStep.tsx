import { useCallback } from 'react';
import type { ApprovedVacancyLetterResult } from '../../vacancies/vacancyLetterApi';
import {
  loadLetterResumePreview,
  type LetterResumePreview,
} from '../../vacancies/vacancyLetterResumePreview';
import { Button, Icon, InfoTip, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { paragraphs } from './model/applyModel';

const TITLES: Readonly<Record<LetterResumePreview['kind'], string>> = {
  targeted: 'Резюме под эту вакансию',
  master: 'Ваше общее резюме',
  general: 'Ваше общее резюме',
  none: 'Резюме пока не из чего собрать',
};
const SOURCES: Readonly<Record<LetterResumePreview['kind'], string>> = {
  targeted: 'Собрано из вашего профиля под требования этой вакансии.',
  master: 'Собрано из вашего профиля, без правок под вакансию.',
  general: 'Файл резюме, который вы загрузили.',
  none: 'В профиле нет мест работы.',
};
const SKELETON = ['w1', 'w2', 'w3', 'w4', 'w5', 'w2', 'w3', 'w4'] as const;

function Sheet({ preview }: { readonly preview: LetterResumePreview }) {
  const lines = paragraphs(preview.text);
  if (lines.length === 0) return null;
  return (
    <div className="cv-stage">
      <article className="cv-sheet cv-doc cv-strict" aria-label="Резюме">
        <section className="cv-page" aria-label={preview.title}>
          {lines.map((line, index) => (
            <p key={`${index}-${line.slice(0, 24)}`}>{line}</p>
          ))}
        </section>
      </article>
    </div>
  );
}

interface PendingProps {
  readonly error: string | null;
  readonly onRetry: () => void;
}

function ResumePending({ error, onRetry }: PendingProps) {
  return (
    <section className="lead cv-lead" aria-labelledby="rs-title">
      <h2 className="lead-title is-long" id="rs-title">
        Резюме
      </h2>
      {error ? (
        <StatusLine
          state="err"
          text={error}
          action={
            <Button size="sm" onClick={onRetry}>
              Повторить
            </Button>
          }
        />
      ) : (
        <div className="cv-stage">
          <div className="cv-skel" role="region" aria-busy="true" aria-label="Резюме собирается">
            {SKELETON.map((width, index) => (
              <div className={`ls-bar ${width}`} key={`${width}-${index}`} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export interface ResumeStepProps {
  readonly vacancyId: string;
  readonly approved: ApprovedVacancyLetterResult['resume'] | null;
  /** Резюме уже одобрено на этом шаге. */
  readonly confirmed: boolean;
  readonly onConfirm: () => void;
}

/** Шаг «Резюме» (O3): то резюме, которое уйдёт с откликом. */
export function ResumeStep({ vacancyId, approved, confirmed, onConfirm }: ResumeStepProps) {
  const load = useCallback(
    (signal: AbortSignal) => loadLetterResumePreview(vacancyId, approved ?? null, signal),
    [vacancyId, approved],
  );
  const { state, reload } = useAsync(load, 'Резюме не собралось.');
  const preview = state.data;
  if (!preview) {
    return <ResumePending error={state.status === 'error' ? state.error : null} onRetry={reload} />;
  }
  return (
    <section className="lead cv-lead" aria-labelledby="rs-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="rs-title">
          {TITLES[preview.kind]}
        </h2>
        <InfoTip label="Источник" text={SOURCES[preview.kind]} />
      </div>
      <Sheet preview={preview} />
      <div className="actions">
        {preview.kind === 'none' ? (
          <Link className="btn is-primary" to={buildNodePath('s01')}>
            <Icon name="profile" />
            Открыть профиль
          </Link>
        ) : (
          <Button variant="primary" icon="check" onClick={onConfirm}>
            {confirmed ? 'К письму' : 'Одобрить резюме'}
          </Button>
        )}
      </div>
    </section>
  );
}
