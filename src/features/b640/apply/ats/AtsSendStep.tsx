import { useEffect, useRef } from 'react';
import { pluralRu } from '../../../../../shared/pluralRu';
import { grantAccountCapabilityConsent } from '../../../account/accountCapabilityConsentApi';
import { CAPABILITY_CONSENT_CURRENT_VERSION } from '../../../legal/capabilityConsents';
import { ConsentDialog, useAction } from '../../account/consentParts';
import { Button, Icon, Link, ResultLine, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import type { ApplyStep } from '../model/applyModel';
import { elapsedLabel } from '../hh/hhSendModel';
import { useMarkSent } from '../hh/useMarkSent';
import type { AtsConfirmation } from './atsFormTypes';
import type { AtsApplyControls, AtsApplyState } from './useAtsApply';

export interface AtsSendStepProps {
  readonly apply: AtsApplyControls;
  readonly url: string | null;
  readonly applicationId: string;
  readonly approvedLabel: string;
  readonly letterText: string;
  readonly hasResume: boolean;
  /** Готовых ответов анкеты. */
  readonly answered: number;
  /** o04: «Отправить отклик с анкетой» уже нажата — отклик уходит сразу. */
  readonly askNow: boolean;
  readonly onAsked: () => void;
  readonly onSent: () => Promise<void>;
  readonly onStep: (step: ApplyStep) => void;
}

function Part({
  title,
  ready,
  text,
  onOpen,
}: {
  readonly title: string;
  readonly ready: boolean;
  readonly text?: string;
  readonly onOpen: () => void;
}) {
  return (
    <li className="row">
      <div>
        <button className="row-title ap-pick" type="button" onClick={onOpen}>
          {title}
        </button>
        {text ? <p className="ap-lines">{text}</p> : null}
      </div>
      {ready ? <span className="tag ok">готово</span> : null}
    </li>
  );
}

const pad = (value: number) => String(value).padStart(2, '0');

/** «Отклик отправлен на jobs.lever.co · 25.11, 14:32». */
export function sentText({ host, pressedAtMs }: AtsConfirmation): string {
  const at = pressedAtMs === null ? null : new Date(pressedAtMs);
  const when = at
    ? ` · ${pad(at.getDate())}.${pad(at.getMonth() + 1)}, ${pad(at.getHours())}:${pad(at.getMinutes())}`
    : '';
  return `Отклик отправлен на ${host}${when}`;
}

function Outcome({
  state,
  host,
  path,
  onRetry,
}: {
  readonly state: AtsApplyState;
  readonly host: string;
  readonly path: string;
  readonly onRetry: () => void;
}) {
  switch (state.kind) {
    case 'reading':
      return (
        <p className="ls-state" role="status">
          Загружаем анкету…
        </p>
      );
    case 'read_failed':
      return (
        <StatusLine
          state="err"
          text="Анкета не загрузилась"
          action={
            <Button size="sm" onClick={onRetry}>
              Повторить
            </Button>
          }
        />
      );
    case 'sending':
      return <StatusLine state="wait" text={`Ждём ответа ${host} · ${elapsedLabel(state.seconds)}`} />;
    case 'unconfirmed':
      return (
        <StatusLine
          state="err"
          text={`${state.host} не подтвердил отклик. Проверьте его на ${state.host}.`}
        />
      );
    case 'refused':
      return <StatusLine state="err" text={`${state.host} не принял отклик.`} />;
    case 'failed':
      return <StatusLine state="err" text="Отклик не отправлен. Повторите." />;
    case 'sent':
      return (
        <>
          <ResultLine text={sentText(state.receipt)} />
          <div className="actions">
            <Link className="btn is-primary" to={path}>
              <Icon name="right" />К отклику
            </Link>
          </div>
        </>
      );
    default:
      return null;
  }
}

/** B787: поручение спрашивают один раз — с первым откликом; после согласия отклик уходит дальше. */
function MandateDialog({ apply }: { readonly apply: AtsApplyControls }) {
  const { busy, failed, run } = useAction(apply.send);
  return (
    <ConsentDialog
      capability="actions_on_behalf"
      open={apply.state.kind === 'mandate'}
      busy={busy}
      failed={failed}
      onGrant={() =>
        run(() =>
          grantAccountCapabilityConsent(
            'actions_on_behalf',
            CAPABILITY_CONSENT_CURRENT_VERSION.actions_on_behalf,
          ),
        )
      }
      onClose={apply.cancel}
    />
  );
}

function useAskNow({ askNow, onAsked, apply }: AtsSendStepProps): void {
  const send = useRef(apply.send);
  send.current = apply.send;
  const { kind } = apply.state;
  useEffect(() => {
    if (!askNow || kind === 'reading') return;
    onAsked();
    if (kind === 'ready' && apply.missing === 0) send.current();
  }, [askNow, kind, apply.missing, onAsked]);
}

const CAN_SEND: ReadonlySet<AtsApplyState['kind']> = new Set([
  'ready',
  'mandate',
  'refused',
  'failed',
]);

function SendActions({ props, marking }: { props: AtsSendStepProps; marking: ReturnType<typeof useMarkSent> }) {
  const { apply, url } = props;
  const { state, missing } = apply;
  const answerFirst = CAN_SEND.has(state.kind) && missing > 0;
  const noun = pluralRu(missing, ['вопрос', 'вопроса', 'вопросов']);
  return (
    <div className="actions">
      {answerFirst ? (
        <Button variant="primary" icon="edit" onClick={() => props.onStep('form')}>
          {`Ответить · ${missing} ${noun}`}
        </Button>
      ) : null}
      {state.kind === 'unconfirmed' ? null : (
        <Button
          {...(answerFirst ? {} : { variant: 'primary' as const })}
          icon="send"
          busy={state.kind === 'sending'}
          disabled={!CAN_SEND.has(state.kind) || answerFirst}
          onClick={apply.send}
        >
          Отправить отклик
        </Button>
      )}
      {url ? (
        <a
          className="btn m-ico"
          aria-label="Открыть вакансию на сайте"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="out" />
          Открыть вакансию на сайте
        </a>
      ) : null}
      <Button
        variant="quiet"
        icon="checkc"
        busy={marking.state.kind === 'busy'}
        disabled={state.kind === 'sending'}
        onClick={marking.mark}
      >
        Я уже откликнулся
      </Button>
    </div>
  );
}

/** Шаг «Отправка» в приложении: форма сайта работодателя уходит одним нажатием (B787). */
export function AtsSendStep(props: AtsSendStepProps) {
  const { apply, onStep, answered } = props;
  const { state } = apply;
  const marking = useMarkSent(props.onSent);
  useAskNow(props);
  const path = buildNodePath('o01c', { responseId: props.applicationId });
  const done = state.kind === 'sent' || marking.state.kind === 'done';
  const noun = pluralRu(answered, ['ответ', 'ответа', 'ответов']);
  return (
    <section className="lead" aria-labelledby="w-title">
      <h2 className="lead-title is-long" id="w-title">
        {apply.missing > 0 ? 'Отправьте отклик' : 'Всё одобрено — можно отправлять'}
      </h2>
      <ul className="rows exp-rows ap-parts" aria-label="Что уйдёт в отклике">
        <Part
          title={`Письмо · ${props.approvedLabel}`}
          text={props.letterText}
          ready
          onOpen={() => onStep('letter')}
        />
        <Part title="Резюме" ready={props.hasResume} onOpen={() => onStep('resume')} />
        {answered > 0 ? (
          <Part
            title={`${answered} ${noun} анкеты`}
            ready={CAN_SEND.has(state.kind) && apply.missing === 0}
            onOpen={() => onStep('form')}
          />
        ) : null}
      </ul>
      {done ? null : <SendActions props={props} marking={marking} />}
      <Outcome state={state} host={apply.host} path={path} onRetry={apply.retry} />
      {state.kind !== 'sent' && marking.state.kind === 'done' ? (
        <>
          <ResultLine text="Отклик отмечен как отправленный" />
          <div className="actions">
            <Link className="btn is-primary" to={path}>
              <Icon name="right" />К отклику
            </Link>
          </div>
        </>
      ) : null}
      {marking.state.kind === 'error' ? <StatusLine state="err" text={marking.state.text} /> : null}
      <MandateDialog apply={apply} />
    </section>
  );
}
