import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ResumeEditDecision,
  ResumeEditsState,
  ResumeLang,
} from '../../../../shared/resumeVacancyEdits';
import type { ResumeTemplate } from '../../../../shared/resumeBuilder/model';
import type { ResumeDocument } from '../../resume/resumeTypes';
import { apiErrorMessage } from '../../coach/apiClient';
import type { ApprovedVacancyLetterResult } from '../../vacancies/vacancyLetterApi';
import {
  loadLetterResumePreview,
  type LetterResumePreview,
} from '../../vacancies/vacancyLetterResumePreview';
import { Button, Icon, InfoTip, Link, StatusLine, useToast } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { editsWord } from './hh/HhResumeEdits';
import { decideResumeEdit, getResumeEdits } from './model/resumeEditsApi';
import { ResumeEdits } from './ResumeEdits';
import { sheetFromDocument } from './model/resumeSheet';
import { ResumeBar, type ResumeLangControl } from './ResumeBar';
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

function ResumeFile({
  document,
  lang,
}: {
  readonly document: ResumeDocument;
  readonly lang: ResumeLangControl | null;
}) {
  const [template, setTemplate] = useState<ResumeTemplate>('strict');
  const resume = useMemo(() => sheetFromDocument(document), [document]);
  return (
    <>
      <ResumeBar resume={resume} template={template} onTemplate={setTemplate} lang={lang} />
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
  /** Одобрена показанная версия. */
  readonly onConfirm: (versionId: string | null) => Promise<void>;
  /** Полоса действия страницы (макет o03, от 768); без неё кнопка стоит под листом. */
  readonly dock: HTMLElement | null;
  readonly onDocument: (document: ResumeDocument | null) => void;
}

interface StepActionsProps {
  readonly kind: LetterResumePreview['kind'];
  readonly confirmed: boolean;
  readonly disabled: boolean;
  readonly onConfirm: () => void;
  readonly dock: HTMLElement | null;
}

function StepActions({ kind, confirmed, disabled, onConfirm, dock }: StepActionsProps) {
  const action =
    kind === 'none' ? (
      <Link className="btn is-primary" to={buildNodePath('s01')}>
        <Icon name="profile" />
        Открыть профиль
      </Link>
    ) : (
      <Button variant="primary" icon="check" disabled={disabled} onClick={onConfirm}>
        {confirmed ? 'К письму' : 'Одобрить резюме'}
      </Button>
    );
  return dock ? createPortal(action, dock) : <div className="actions">{action}</div>;
}

/** Переключение языка: пока строки переводятся, лист прежний. */
function useLang(
  value: ResumeLang | null | undefined,
  decide: (decision: ResumeEditDecision) => Promise<void>,
  reading: boolean,
): ResumeLangControl | null {
  const toast = useToast();
  const [wanted, setWanted] = useState<ResumeLang | null>(null);
  if (!value) return null;
  const onChange = async (lang: ResumeLang) => {
    setWanted(lang);
    try {
      await decide({ action: 'lang', lang });
    } catch (reason) {
      toast.show({ text: apiErrorMessage(reason, 'Перевод не собрался. Повторите.') });
    } finally {
      setWanted(null);
    }
  };
  return {
    value: wanted ?? value,
    busy: wanted !== null || reading,
    onChange: (lang) => void onChange(lang),
  };
}

const NO_EDITS: ResumeEditsState = { edits: [], lang: null };

/** Лист и правки читаются вместе: после решения кандидата лист собирается заново. */
function useResumeStep(vacancyId: string, approved: ResumeStepProps['approved']) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const preview = await loadLetterResumePreview(vacancyId, approved ?? null, signal);
      // Правок без листа под вакансию не бывает; сбой их чтения лист не закрывает.
      const choices =
        preview.kind === 'targeted'
          ? await getResumeEdits(vacancyId, signal).catch(() => NO_EDITS)
          : NO_EDITS;
      return { preview, choices };
    },
    [vacancyId, approved],
  );
  const { state, reload, setData } = useAsync(load, 'Резюме не собралось.');
  const reading = state.status === 'loading';
  const decide = async (decision: ResumeEditDecision) => {
    const choices = await decideResumeEdit(vacancyId, decision);
    setData((current) => ({ ...current, choices }));
    reload();
  };
  return { state, reload, decide, lang: useLang(state.data?.choices.lang, decide, reading) };
}

function titleOf(preview: LetterResumePreview, edits: ResumeEditsState['edits']): string {
  const active = edits.filter((item) => !item.cancelled).length;
  return active > 0 ? `${editsWord(active)} под эту вакансию` : TITLES[preview.kind];
}

/** «Одобрить резюме»: отказ сервера оставляет кандидата на шаге. */
function useConfirm(onConfirm: ResumeStepProps['onConfirm'], versionId: string | null) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const confirm = () => {
    setBusy(true);
    onConfirm(versionId)
      .catch((reason: unknown) =>
        toast.show({ text: apiErrorMessage(reason, 'Резюме не одобрилось. Повторите.') }),
      )
      .finally(() => setBusy(false));
  };
  return { busy, confirm };
}

/** Шаг «Резюме» (O3): то резюме, которое уйдёт с откликом. */
export function ResumeStep(props: ResumeStepProps) {
  const { vacancyId, approved, confirmed, onConfirm, dock, onDocument } = props;
  const { state, reload, decide, lang } = useResumeStep(vacancyId, approved);
  const { busy, confirm } = useConfirm(onConfirm, state.data?.preview.versionId ?? null);
  const preview = state.data?.preview;
  const edits = state.data?.choices.edits ?? [];
  useEffect(() => onDocument(preview?.document ?? null), [onDocument, preview?.document]);
  if (!preview) {
    return <ResumePending error={state.status === 'error' ? state.error : null} onRetry={reload} />;
  }
  return (
    <section className="lead cv-lead" aria-labelledby="rs-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="rs-title">
          {titleOf(preview, edits)}
        </h2>
        <InfoTip label="Источник" text={SOURCES[preview.kind]} />
      </div>
      {edits.length > 0 ? (
        <ResumeEdits edits={edits} readOnly={Boolean(approved)} onDecide={decide} />
      ) : null}
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
      {preview.document ? (
        <ResumeFile document={preview.document} lang={approved ? null : lang} />
      ) : null}
      <StepActions
        kind={preview.kind}
        confirmed={confirmed}
        disabled={busy || state.status !== 'ready' || Boolean(lang?.busy)}
        onConfirm={confirm}
        dock={dock}
      />
    </section>
  );
}
