import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import type { ParsedOfferLetter } from '../../../../shared/offerLetterParse';
import { Button, Icon, Link, StatusLine } from '../kit';
import { useAsync, type AsyncState } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { CtxHead } from '../shell/CtxHead';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { loadOffers, putOfferDecision, type OffersData } from './data/offersApi';
import { OfferCalc } from './OfferCalc';
import { WORKING_STATUS_PATH } from './OfferDecision';
import { OfferFields } from './OfferFields';
import { OfferLetterPaste } from './OfferLetterPaste';
import { flashOfferSaved, NEW_OFFER_ID } from './OffersScreen';
import {
  formFromCard,
  parseOfferForm,
  previewTerms,
  type OfferForm,
  type OfferFormErrors,
} from './model/offerForm';
import { applyLetter, type OfferFormKey } from './model/offerLetterForm';
import { formatDay, payText, type OfferCard } from './model/offerModel';
import { useSaveOffer, type SaveState } from './useSaveOffer';

function ContextHead({ card }: { readonly card: OfferCard }) {
  const pay = payText(card, 'ORIG', null);
  const due = formatDay(card.respondBy);
  return (
    <CtxHead
      kind="Оффер"
      title={[card.title, card.company].filter(Boolean).join(' · ')}
      meta={[pay.needsTax ? pay.text : `${pay.text} на руки`, ...(due ? [`ответ до ${due}`] : [])]}
      open={{
        path: buildNodePath('o01c', { responseId: card.applicationId }),
        label: 'Открыть: отклик',
      }}
    />
  );
}

function AcceptBlock({ card }: { readonly card: OfferCard }) {
  const { navigate } = useShell();
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  async function accept() {
    setState('busy');
    try {
      await putOfferDecision(card.applicationId, 'accepted');
      navigate(WORKING_STATUS_PATH);
    } catch {
      setState('error');
    }
  }
  return (
    <section className="mod is-quiet" aria-labelledby="of-acc">
      <h3 className="mod-title" id="of-acc">
        Оффер принят?
      </h3>
      <div className="actions">
        <Button disabled={state === 'busy'} onClick={() => void accept()}>
          <Icon name="swap" />
          Принял оффер — перейти в «Работаю»
        </Button>
      </div>
      {state === 'error' ? (
        <StatusLine state="err" text="Решение не записалось. Попробуйте ещё раз." />
      ) : null}
    </section>
  );
}

function SaveActions(props: { readonly state: SaveState; readonly onRetry: () => void }) {
  return (
    <>
      {props.state === 'error' ? (
        <StatusLine
          state="err"
          text="Условия не сохранились"
          action={
            <Button size="sm" onClick={props.onRetry}>
              Повторить
            </Button>
          }
        />
      ) : null}
      <div className="actions of-save">
        <Button type="submit" disabled={props.state === 'saving'}>
          <Icon name="check" />
          Сохранить условия
        </Button>
        <Link className="btn is-quiet" to={buildNodePath('o06')}>
          Отмена
        </Link>
      </div>
    </>
  );
}

function PasteLead(props: { readonly children?: ReactNode }) {
  return (
    <section className="lead col-wide of-paste" aria-labelledby="op-t">
      <h2 className="lead-title is-long" id="op-t">
        Условия оффера
      </h2>
      {props.children}
    </section>
  );
}

/** Состояние формы и пометки «из письма»: правка поля делает его словами кандидата. */
function useOfferForm(card: OfferCard | null) {
  const [form, setForm] = useState<OfferForm>(() => formFromCard(card));
  const [fromLetter, setFromLetter] = useState<ReadonlySet<OfferFormKey> | null>(null);
  function change(key: OfferFormKey, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setFromLetter((current) =>
      current?.has(key) ? new Set([...current].filter((item) => item !== key)) : current,
    );
  }
  function letter(parsed: ParsedOfferLetter): number {
    const applied = applyLetter(form, parsed);
    setForm(applied.form);
    if (applied.fromLetter.size > 0) setFromLetter(applied.fromLetter);
    return applied.fromLetter.size;
  }
  return { form, fromLetter, change, letter };
}

function TermsForm({ card }: { readonly card: OfferCard | null }) {
  const { navigate } = useShell();
  const { form, fromLetter, change, letter } = useOfferForm(card);
  const [errors, setErrors] = useState<OfferFormErrors>({});
  const save = useSaveOffer(card, () => {
    flashOfferSaved();
    navigate(buildNodePath('o06'));
  });
  function submit(event?: FormEvent) {
    event?.preventDefault();
    const parsed = parseOfferForm(form, card === null);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (parsed.ok) void save.run(parsed);
  }
  return (
    <>
      <PasteLead>
        <OfferLetterPaste onParsed={letter} />
      </PasteLead>
      <div className="col">
        <form className="mod of-form" aria-labelledby="of-ft" noValidate onSubmit={submit}>
          <h3 className="mod-title" id="of-ft">
            Поля оффера
          </h3>
          <OfferFields
            form={form}
            errors={errors}
            isNew={card === null}
            fromLetter={fromLetter}
            onChange={change}
          />
          <SaveActions state={save.state} onRetry={() => submit()} />
        </form>
        {card ? <AcceptBlock card={card} /> : null}
      </div>
      <div className="col">
        <OfferCalc terms={previewTerms(form)} />
      </div>
    </>
  );
}

function StepTabs({ offerId }: { readonly offerId: string }) {
  return (
    <nav className="tabs sec-tabs r6-steps" aria-label="Шаги">
      <div className="sec-tabs-in">
        <Link to={buildNodePath('o06a', { offerId })} aria-current="page">
          Условия
        </Link>
        <Link to={buildNodePath('o06')}>Решение</Link>
      </div>
    </nav>
  );
}

function LoadLine(props: { readonly state: AsyncState<OffersData>; readonly onRetry: () => void }) {
  if (props.state.status === 'error') {
    return (
      <StatusLine
        state="err"
        text={props.state.error}
        action={
          <Button size="sm" onClick={props.onRetry}>
            Повторить
          </Button>
        }
      />
    );
  }
  if (props.state.status === 'ready') {
    return (
      <StatusLine
        state="err"
        text="Такого оффера нет"
        action={
          <Link className="row-act" to={buildNodePath('o06')}>
            К офферам
          </Link>
        }
      />
    );
  }
  return (
    <p className="ls-state" role="status">
      Загружаем оффер…
    </p>
  );
}

/** «Условия оффера» (O6a): поля оффера, доход по формуле, «принял → Работаю». */
export function OfferTermsScreen({ offerId }: { readonly offerId: string }) {
  const isNew = offerId === NEW_OFFER_ID;
  const load = useCallback((signal: AbortSignal) => loadOffers(signal), []);
  const { state, reload } = useAsync(load, 'Оффер не загрузился.');
  const card = state.data?.cards.find((item) => item.applicationId === offerId) ?? null;
  useScreenChrome({
    crumb: isNew ? 'Новый оффер' : card?.company,
    rootData: { mtight: '1' },
  });
  const ready = isNew || state.status === 'ready';
  return (
    <>
      <StepTabs offerId={offerId} />
      <div className="page two" data-b640-node="o06a" data-b640-section="offers">
        {card ? <ContextHead card={card} /> : null}
        {ready && (isNew || card) ? (
          <TermsForm key={card?.applicationId ?? NEW_OFFER_ID} card={card} />
        ) : (
          <>
            <PasteLead />
            <LoadLine state={state} onRetry={reload} />
          </>
        )}
      </div>
    </>
  );
}
