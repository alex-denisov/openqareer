import { useId, useState } from 'react';
import { listApplications, patchApplication } from '../../applications/applicationsApi';
import { recordVacancyApplication } from '../../coach/coachApi';
import { apiErrorMessage } from '../../coach/apiClient';
import type { ApprovedVacancyLetterResult } from '../../vacancies/vacancyLetterApi';
import { Button, Icon, Link, ResultLine, StatusLine, useToast } from '../kit';
import { buildNodePath } from '../routes';
import { sendFrom } from '../responses/model/platform';
import type { ApplyHead } from './model/applyModel';

type Sent =
  | { readonly kind: 'idle' | 'busy' | 'done' }
  | { readonly kind: 'error'; readonly text: string };

interface CopyItemProps {
  readonly label: string;
  readonly text: string;
}

function CopyItem({ label, text }: CopyItemProps) {
  const toast = useToast();
  const labelId = useId();
  const copy = () => {
    const failed = () => toast.show({ text: 'Не получилось скопировать' });
    try {
      void navigator.clipboard
        .writeText(text)
        .then(() => toast.show({ text: 'Текст скопирован' }))
        .catch(failed);
    } catch {
      failed();
    }
  };
  return (
    <li className="cb-item">
      <div className="cb-main">
        <p className="cb-l" id={labelId}>
          {label}
        </p>
        <p className="cb-t">{text}</p>
      </div>
      <button
        className="icon-btn cb-copy"
        type="button"
        aria-label="Скопировать"
        aria-describedby={labelId}
        onClick={copy}
      >
        <Icon name="copy" />
      </button>
    </li>
  );
}

interface MarkInput {
  readonly vacancyId: string;
  readonly head: ApplyHead;
  readonly sourceType: string;
  readonly applicationId: string;
}

/**
 * «Я откликнулся». Со ссылкой на вакансию — прежняя отметка отклика; без ссылки (её требует
 * тот маршрут) стадия меняется у самой карточки, которую создало одобрение письма.
 */
async function markApplied({ vacancyId, head, sourceType, applicationId }: MarkInput): Promise<void> {
  if (head.url) {
    await recordVacancyApplication({
      clusterId: vacancyId,
      status: 'applied',
      vacancy: { title: head.title, company: head.company, url: head.url, source: sourceType },
    });
    return;
  }
  const card = (await listApplications()).find((item) => item.id === applicationId);
  if (!card) throw new Error('application_missing');
  if (card.stage !== 'saved') return;
  await patchApplication(card.id, { expectedVersion: card.version, stage: 'applied' });
}

function NeedsLetter({ onLetter }: { readonly onLetter: () => void }) {
  return (
    <section className="lead" aria-labelledby="w-title">
      <h2 className="lead-title is-long" id="w-title">
        Сначала одобрите письмо
      </h2>
      <div className="actions">
        <Button variant="primary" icon="file" onClick={onLetter}>
          К письму
        </Button>
      </div>
    </section>
  );
}

interface SentActionsProps {
  readonly sent: Sent;
  readonly responsePath: string;
  readonly onConfirm: () => void;
}

function SentActions({ sent, responsePath, onConfirm }: SentActionsProps) {
  if (sent.kind !== 'done') {
    return (
      <div className="actions">
        <Button variant="primary" icon="checkc" busy={sent.kind === 'busy'} onClick={onConfirm}>
          Я откликнулся
        </Button>
      </div>
    );
  }
  return (
    <>
      <ResultLine text="Отклик отмечен как отправленный" />
      <div className="actions">
        <Link className="btn is-primary" to={responsePath}>
          <Icon name="right" />
          К отклику
        </Link>
      </div>
    </>
  );
}

export interface SendStepProps {
  readonly vacancyId: string;
  readonly head: ApplyHead;
  /** Площадка в записи отклика: `hh`, `linkedin`, `manual`. */
  readonly sourceType: string;
  readonly approved: ApprovedVacancyLetterResult | null;
  readonly letterText: string;
  /** Ответы анкеты работодателя для вставки; пусто — анкеты нет. */
  readonly answersText?: string;
  readonly onLetter: () => void;
}

/** Шаг «Отправка» в вебе (O4d): письмо для вставки на площадке и отметка «Я откликнулся». */
export function SendStep(props: SendStepProps) {
  const { vacancyId, head, sourceType, approved, letterText, onLetter } = props;
  const [sent, setSent] = useState<Sent>({ kind: 'idle' });
  if (!approved) return <NeedsLetter onLetter={onLetter} />;
  const applicationId = approved.applicationId;

  function confirm() {
    setSent({ kind: 'busy' });
    markApplied({ vacancyId, head, sourceType, applicationId })
      .then(() => setSent({ kind: 'done' }))
      .catch((reason: unknown) =>
        setSent({ kind: 'error', text: apiErrorMessage(reason, 'Отметка не сохранилась. Повторите.') }),
      );
  }

  return (
    <section className="lead" aria-labelledby="w-title">
      <h2 className="lead-title is-long" id="w-title">
        {head.platform ? `Отправьте отклик ${sendFrom(head.platform)}` : 'Отправьте отклик'}
      </h2>
      {head.url ? (
        <div className="actions cb-top">
          <a className="btn m-ico" href={head.url} target="_blank" rel="noopener noreferrer">
            <Icon name="out" />
            Открыть вакансию на сайте
          </a>
        </div>
      ) : null}
      <ul className="cb-list" aria-label="Письмо для отклика">
        <CopyItem label="Сопроводительное письмо" text={letterText} />
        {props.answersText ? <CopyItem label="Ответы анкеты" text={props.answersText} /> : null}
      </ul>
      <SentActions
        sent={sent}
        responsePath={buildNodePath('o01c', { responseId: applicationId })}
        onConfirm={confirm}
      />
      {sent.kind === 'error' ? <StatusLine state="err" text={sent.text} /> : null}
    </section>
  );
}
