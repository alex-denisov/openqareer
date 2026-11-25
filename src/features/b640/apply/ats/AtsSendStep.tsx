import { pluralRu } from '../../../../../shared/pluralRu';
import { grantAccountCapabilityConsent } from '../../../account/accountCapabilityConsentApi';
import { CAPABILITY_CONSENT_CURRENT_VERSION } from '../../../legal/capabilityConsents';
import { ConsentDialog, useAction } from '../../account/consentParts';
import { Button, Icon, Link, ResultLine, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import type { ApplyStep } from '../model/applyModel';
import { elapsedLabel } from '../hh/hhSendModel';
import { useMarkSent } from '../hh/useMarkSent';
import { AtsAgain } from './AtsAgain';
import type { AtsConfirmation } from './atsFormTypes';
import type { AtsObstacle } from './atsRun';
import { isLive } from './useAtsWindow';
import { canSendAts, type AtsApplyControls, type AtsApplyState } from './useAtsApply';

export interface AtsSendStepProps {
  readonly apply: AtsApplyControls;
  readonly url: string | null;
  readonly employer: string;
  readonly applicationId: string;
  readonly approvedLabel: string;
  readonly letterText: string;
  readonly hasResume: boolean;
  /** Готовых ответов анкеты. */
  readonly answered: number;
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

/** «Отправлено 25.11, 14:32 · jobs.lever.co». */
export function sentText({ host, pressedAtMs }: AtsConfirmation): string {
  const at = pressedAtMs === null ? null : new Date(pressedAtMs);
  const when = at
    ? ` ${pad(at.getDate())}.${pad(at.getMonth() + 1)}, ${pad(at.getHours())}:${pad(at.getMinutes())}`
    : '';
  return `Отправлено${when} · ${host}`;
}

function Done({ text, path }: { readonly text: string; readonly path: string }) {
  return (
    <>
      <ResultLine text={text} />
      <div className="actions">
        <Link className="btn is-primary" to={path}>
          <Icon name="right" />К отклику
        </Link>
      </div>
    </>
  );
}

function ReadFailed({ onRetry }: { readonly onRetry: () => void }) {
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
}

function failedText(rejected: AtsObstacle | undefined, host: string): string {
  if (!rejected) return 'Отклик не отправлен. Повторите.';
  if (rejected === 'button')
    return `Отклик не отправлен: кнопка отправки на ${host} не сработала. Повторите.`;
  return `${host} не принял ${rejected === 'resume' ? 'резюме' : 'письмо'}. Повторите.`;
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
      return <ReadFailed onRetry={onRetry} />;
    case 'sending':
      return (
        <StatusLine state="wait" text={`Ждём ответа ${host} · ${elapsedLabel(state.seconds)}`} />
      );
    case 'code':
      return <StatusLine state="wait" text="На почту пришёл код" />;
    case 'captcha':
      return <StatusLine state="wait" text={`Проверка на ${state.host}`} />;
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
      return <StatusLine state="err" text={failedText(state.rejected, host)} />;
    case 'sent':
      return <Done text={sentText(state.receipt)} path={path} />;
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

function OpenOnSite({ url }: { readonly url: string }) {
  return (
    <a
      className="btn m-ico"
      aria-label="Вакансия на сайте"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon name="out" />
      Вакансия на сайте
    </a>
  );
}

function SendActions({
  props,
  marking,
}: {
  props: AtsSendStepProps;
  marking: ReturnType<typeof useMarkSent>;
}) {
  const { apply, url } = props;
  const { state, missing } = apply;
  const answerFirst = canSendAts(state.kind) && missing > 0;
  const noun = pluralRu(missing, ['вопрос', 'вопроса', 'вопросов']);
  return (
    <div className="actions">
      {answerFirst ? (
        <Button variant="primary" icon="edit" onClick={() => props.onStep('form')}>
          {`Ответить · ${noun}`}
        </Button>
      ) : null}
      {isLive(state) ? (
        <Button variant="primary" icon="out" onClick={apply.showForm}>
          {state.kind === 'code' ? 'Ввести код' : 'Открыть форму'}
        </Button>
      ) : null}
      {'live' in state || answerFirst ? null : (
        <Button
          variant="primary"
          icon="send"
          busy={state.kind === 'sending'}
          disabled={!canSendAts(state.kind)}
          onClick={apply.send}
        >
          Отправить отклик
        </Button>
      )}
      {url ? <OpenOnSite url={url} /> : null}
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

/** Ответы формы целиком: вопрос и то, что в него встанет. */
function Answers({ items }: Pick<AtsApplyControls, 'items'>) {
  if (items.length === 0) return null;
  return (
    <details className="more-n">
      <summary>
        <Icon name="down" />
        {`Ответы · ${items.length}`}
      </summary>
      <ul className="cb-list" aria-label="Ответы">
        {items.map((item) => (
          <li className="cb-item" key={item.key}>
            <div className="cb-main">
              <p className="cb-l">{item.question}</p>
              <p className="cb-t">{item.answer}</p>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

const UNREAD: ReadonlySet<AtsApplyState['kind']> = new Set(['reading', 'read_failed']);

function titleOf({ state, missing }: AtsApplyControls): string {
  if (state.kind === 'code') return 'Введите код';
  if (state.kind === 'captcha') return 'Пройдите проверку';
  if (state.kind === 'unconfirmed') return 'Отклик не подтверждён';
  return missing > 0 ? 'Отправьте отклик' : 'Всё одобрено — можно отправлять';
}

/** Шаг «Отправка» в приложении: форма сайта работодателя уходит одним нажатием (B787). */
export function AtsSendStep(props: AtsSendStepProps) {
  const { apply, onStep, answered } = props;
  const { state } = apply;
  const marking = useMarkSent(props.onSent);
  const path = buildNodePath('o01c', { responseId: props.applicationId });
  const marked = state.kind !== 'sent' && marking.state.kind === 'done';
  const done = marked || state.kind === 'sent';
  const noun = pluralRu(answered, ['ответ', 'ответа', 'ответов']);
  return (
    <section className="lead" aria-labelledby="w-title">
      <h2 className="lead-title is-long" id="w-title">
        {done ? 'Отклик отправлен' : titleOf(apply)}
      </h2>
      <ul className="rows exp-rows ap-parts" aria-label="Что уйдёт в отклике">
        <li className="row">
          <div>
            <div className="row-title">{props.employer || apply.host}</div>
            {props.employer ? <p className="ap-lines">{apply.host}</p> : null}
          </div>
        </li>
        <Part
          title={`Письмо · ${props.approvedLabel}`}
          text={props.letterText}
          ready
          onOpen={() => onStep('letter')}
        />
        <Part title="Резюме" ready={props.hasResume} onOpen={() => onStep('resume')} />
        {answered > 0 ? (
          <Part
            title={`${noun} анкеты`}
            ready={!UNREAD.has(state.kind) && apply.missing === 0}
            onOpen={() => onStep('form')}
          />
        ) : null}
      </ul>
      <Answers items={apply.items} />
      {done ? null : <SendActions props={props} marking={marking} />}
      {marked ? (
        <Done text="Отклик отмечен как отправленный" path={path} />
      ) : (
        <Outcome state={state} host={apply.host} path={path} onRetry={apply.retry} />
      )}
      {state.kind === 'unconfirmed' && !state.live && !done ? (
        <AtsAgain onAgain={apply.again} />
      ) : null}
      {marking.state.kind === 'error' ? <StatusLine state="err" text={marking.state.text} /> : null}
      <MandateDialog apply={apply} />
    </section>
  );
}
