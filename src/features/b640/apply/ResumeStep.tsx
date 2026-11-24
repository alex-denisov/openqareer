import { useCallback, useMemo, useState } from 'react';
import type { ResumeTemplate } from '../../../../shared/resumeBuilder/model';
import type { ResumeDocument } from '../../resume/resumeTypes';
import type { ApprovedVacancyLetterResult } from '../../vacancies/vacancyLetterApi';
import {
  loadLetterResumePreview,
  type LetterResumePreview,
} from '../../vacancies/vacancyLetterResumePreview';
import { Button, Icon, InfoTip, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { sheetFromDocument } from './model/resumeSheet';
import { ResumeBar } from './ResumeBar';
import { ResumePage } from './ResumePage';

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

function ResumeFile({ document }: { readonly document: ResumeDocument }) {
  const [template, setTemplate] = useState<ResumeTemplate>('strict');
  const resume = useMemo(() => sheetFromDocument(document), [document]);
  return (
    <>
      <ResumeBar resume={resume} template={template} onTemplate={setTemplate} />
      <ResumePage resume={resume} template={template} />
    </>
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
        <>
          <div className="cv-stage">
            <div className="cv-skel" role="region" aria-busy="true" aria-label="Резюме собирается">
              {SKELETON.map((width, index) => (
                <div className={`ls-bar ${width}`} key={`${width}-${index}`} />
              ))}
            </div>
          </div>
          <div className="actions">
            <Button variant="primary" icon="check" disabled>
              Одобрить резюме
            </Button>
          </div>
        </>
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
      {preview.document ? <ResumeFile document={preview.document} /> : null}
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
