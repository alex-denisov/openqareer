import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ResumeEditDecision } from '../../../../shared/resumeVacancyEdits';
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
import { HhResumeSelect } from './HhResumeSelect';
import { editsWord } from './hh/HhResumeEdits';
import { decideResumeEdit, getResumeEdits } from './model/resumeEditsApi';
import { ResumeEdits } from './ResumeEdits';
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
  /** Отклик на hh.ru: рядом выбор резюме hh.ru, которым он уйдёт. */
  readonly onHh: boolean;
  readonly onDocument: (document: ResumeDocument | null) => void;
}

interface StepActionsProps {
  readonly kind: LetterResumePreview['kind'];
  readonly confirmed: boolean;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
}

function StepActions({ kind, confirmed, disabled, onConfirm }: StepActionsProps) {
  return (
    <div className="actions">
      {kind === 'none' ? (
        <Link className="btn is-primary" to={buildNodePath('s01')}>
          <Icon name="profile" />
          Открыть профиль
        </Link>
      ) : (
        <Button variant="primary" icon="check" disabled={disabled} onClick={onConfirm}>
          {confirmed ? 'К письму' : 'Одобрить резюме'}
        </Button>
      )}
    </div>
  );
}

/** Лист и правки читаются вместе: после решения кандидата лист собирается заново. */
function useResumeStep(vacancyId: string, approved: ResumeStepProps['approved']) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const preview = await loadLetterResumePreview(vacancyId, approved ?? null, signal);
      // Правок без листа под вакансию не бывает; сбой их чтения лист не закрывает.
      const edits =
        preview.kind === 'targeted' ? await getResumeEdits(vacancyId, signal).catch(() => []) : [];
      return { preview, edits };
    },
    [vacancyId, approved],
  );
  const { state, reload, setData } = useAsync(load, 'Резюме не собралось.');
  const decide = async (decision: ResumeEditDecision) => {
    const edits = await decideResumeEdit(vacancyId, decision);
    setData((current) => ({ ...current, edits }));
    reload();
  };
  return { state, reload, decide };
}

/** Шаг «Резюме» (O3): то резюме, которое уйдёт с откликом. */
export function ResumeStep({
  vacancyId,
  approved,
  confirmed,
  onConfirm,
  onHh,
  onDocument,
}: ResumeStepProps) {
  const { state, reload, decide } = useResumeStep(vacancyId, approved);
  const preview = state.data?.preview;
  const edits = state.data?.edits ?? [];
  const active = edits.filter((item) => !item.cancelled).length;
  const document = preview?.document ?? null;
  useEffect(() => onDocument(document), [onDocument, document]);
  if (!preview) {
    return <ResumePending error={state.status === 'error' ? state.error : null} onRetry={reload} />;
  }
  return (
    <section className="lead cv-lead" aria-labelledby="rs-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="rs-title">
          {active > 0 ? `${editsWord(active)} под эту вакансию` : TITLES[preview.kind]}
        </h2>
        <InfoTip label="Источник" text={SOURCES[preview.kind]} />
      </div>
      {edits.length > 0 ? (
        <ResumeEdits edits={edits} readOnly={Boolean(approved)} onDecide={decide} />
      ) : null}
      {onHh && !approved && preview.kind !== 'none' ? <HhResumeSelect /> : null}
      {state.status === 'error' ? (
        <StatusLine
          state="err"
          text={state.error}
          action={
            <Button size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        />
      ) : null}
      {preview.document ? <ResumeFile document={preview.document} /> : null}
      <StepActions
        kind={preview.kind}
        confirmed={confirmed}
        disabled={state.status !== 'ready'}
        onConfirm={onConfirm}
      />
    </section>
  );
}
