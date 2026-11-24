import { useCallback, useEffect, useState } from 'react';
import { manualApplyReasonText } from '../../../../shared/manualApply';
import { apiErrorMessage } from '../../coach/apiClient';
import type { ApprovedVacancyLetterResult } from '../../vacancies/vacancyLetterApi';
import { loadLetterResumePreview } from '../../vacancies/vacancyLetterResumePreview';
import { Button, Icon, Link, ResultLine, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { pluralRu } from '../responses/model/responseRow';
import { buildNodePath } from '../routes';
import { useShell } from '../shell/ShellContext';
import { closeManualApply } from './data/manualApplyApi';
import type { QuestionnaireState } from './FormStep';
import type { ApplyStep } from './model/applyModel';
import { answerOf, readiness } from './model/formModel';
import { sheetFromDocument } from './model/resumeSheet';
import { DownloadMenu } from './ResumeBar';
import { CopyItem } from './SendStep';
import type { ManualApplyFlow } from './useManualApply';

type Closing =
  | { readonly kind: 'idle' | 'sending' | 'skipping' | 'sent' }
  | { readonly kind: 'error'; readonly text: string };

export interface ManualSendStepProps {
  readonly manual: ManualApplyFlow;
  readonly letterText: string;
  readonly resume: ApprovedVacancyLetterResult['resume'] | null;
  readonly questionnaire: QuestionnaireState;
  readonly onStep: (step: ApplyStep) => void;
}

/** Резюме под вакансию файлом: PDF и DOCX. */
function ResumeItem({
  vacancyId,
  resume,
}: { readonly vacancyId: string } & Pick<ManualSendStepProps, 'resume'>) {
  const load = useCallback(
    (signal: AbortSignal) => loadLetterResumePreview(vacancyId, resume ?? null, signal),
    [vacancyId, resume],
  );
  const { state, reload } = useAsync(load, 'Резюме не собралось.');
  const document = state.data?.document;
  if (state.status === 'error') {
    return (
      <li className="cb-item">
        <StatusLine
          state="err"
          text={state.error}
          action={
            <Button size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        />
      </li>
    );
  }
  if (state.status === 'ready' && !document) return null;
  return (
    <li className="cb-item">
      <div className="cb-main">
        <p className="cb-l">Резюме</p>
        <p className="cb-t">{document ? 'PDF или DOCX' : 'Готовим резюме…'}</p>
      </div>
      {document ? <DownloadMenu resume={sheetFromDocument(document)} template="strict" /> : null}
    </li>
  );
}

function LetterItem({
  text,
  pending,
  onLetter,
}: {
  readonly text: string;
  readonly pending: boolean;
  readonly onLetter: () => void;
}) {
  if (text) return <CopyItem label="Сопроводительное письмо" text={text} />;
  return (
    <li className="cb-item">
      <div className="cb-main">
        <p className="cb-l">Сопроводительное письмо</p>
        <p className="cb-t">{pending ? 'Готовим письмо…' : 'Письмо не собралось'}</p>
      </div>
      {pending ? null : (
        <Button size="sm" onClick={onLetter}>
          К письму
        </Button>
      )}
    </li>
  );
}

interface FooterProps {
  readonly closing: Closing;
  readonly missing: number;
  readonly onForm: () => void;
  readonly onClose: (how: 'sent' | 'skip') => void;
}

function Footer({ closing, missing, onForm, onClose }: FooterProps) {
  const busy = closing.kind === 'sending' || closing.kind === 'skipping';
  const noun = pluralRu(missing, ['вопрос', 'вопроса', 'вопросов']);
  return (
    <div className="actions">
      {missing > 0 ? (
        <Button variant="primary" icon="edit" onClick={onForm}>
          {`Ответить · ${missing} ${noun}`}
        </Button>
      ) : null}
      <Button
        {...(missing > 0 ? {} : { variant: 'primary' as const })}
        icon="checkc"
        busy={closing.kind === 'sending'}
        disabled={busy}
        onClick={() => onClose('sent')}
      >
        Отправлено
      </Button>
      <Button
        variant="quiet"
        busy={closing.kind === 'skipping'}
        disabled={busy}
        onClick={() => onClose('skip')}
      >
        Не откликаюсь
      </Button>
    </div>
  );
}

/** «Отправлено» и «Не откликаюсь». */
function useClosing(vacancyId: string) {
  const { navigate } = useShell();
  const [closing, setClosing] = useState<Closing>({ kind: 'idle' });
  function close(how: 'sent' | 'skip') {
    setClosing({ kind: how === 'sent' ? 'sending' : 'skipping' });
    closeManualApply(vacancyId, how)
      .then(() => {
        if (how === 'skip') navigate(buildNodePath('o01'));
        else setClosing({ kind: 'sent' });
      })
      .catch((reason: unknown) =>
        setClosing({
          kind: 'error',
          text: apiErrorMessage(reason, 'Отметка не сохранилась. Повторите.'),
        }),
      );
  }
  return { closing, close };
}

function SentResult({ applicationId }: { readonly applicationId: string }) {
  return (
    <>
      <ResultLine text="Отклик отмечен как отправленный" />
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('o01c', { responseId: applicationId })}>
          <Icon name="right" />К отклику
        </Link>
      </div>
    </>
  );
}

function OpenVacancy({ url }: { readonly url: string }) {
  return (
    <div className="actions cb-top">
      <a
        className="btn m-ico"
        aria-label="Открыть вакансию"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="out" />
        Открыть вакансию
      </a>
    </div>
  );
}

/** Шаг «Отправка» у отклика, который кандидат отправляет сам (B787): всё собрано, остаётся вставить. */
export function ManualSendStep({
  manual,
  letterText,
  resume,
  questionnaire,
  onStep,
}: ManualSendStepProps) {
  const { item, refresh } = manual;
  const { closing, close } = useClosing(item.vacancyId);
  const questions = questionnaire.form?.questions ?? [];
  const ready = readiness(questions, questionnaire.draft);
  // Вернулись с ответов: состояние очереди на сервере уже другое.
  useEffect(refresh, [refresh]);

  return (
    <section className="lead" aria-labelledby="w-title">
      <h2 className="lead-title is-long" id="w-title">
        {manualApplyReasonText(item.reason, item.host)}
      </h2>
      <OpenVacancy url={item.url} />
      <ul className="cb-list" aria-label="Резюме, письмо и ответы">
        <ResumeItem vacancyId={item.vacancyId} resume={resume} />
        <LetterItem
          text={letterText || item.letter || ''}
          pending={item.preparing}
          onLetter={() => onStep('letter')}
        />
        {questions.map((question) => {
          const text = answerOf(questionnaire.draft, question.id).trim();
          return text ? <CopyItem key={question.id} label={question.text} text={text} /> : null;
        })}
      </ul>
      {closing.kind === 'sent' ? (
        <SentResult applicationId={item.applicationId} />
      ) : (
        <Footer
          closing={closing}
          missing={ready.missingRequired}
          onForm={() => onStep('form')}
          onClose={close}
        />
      )}
      {closing.kind === 'error' ? <StatusLine state="err" text={closing.text} /> : null}
    </section>
  );
}
