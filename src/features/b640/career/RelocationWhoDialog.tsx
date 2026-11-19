import { useState } from 'react';
import {
  getRelocationQuestionnaire,
  grantRelocationConsent,
  type RelocationQuestionnaireResponse,
} from '../../relocation/relocationApi';
import { Button, Dialog, StatusLine } from '../kit';
import { saveFamily } from './relocationCostsApi';
import type { Family } from './relocationCostsModel';

const MAX_CHILDREN = 10;

/** Согласие на данные о мобильности: без него анкета и траты не сохраняются. */
async function ensureConsent(
  questionnaire: RelocationQuestionnaireResponse | null,
): Promise<RelocationQuestionnaireResponse> {
  if (!questionnaire?.consent.granted) await grantRelocationConsent();
  return getRelocationQuestionnaire();
}

export function ConsentCheck(props: {
  readonly questionnaire: RelocationQuestionnaireResponse | null;
  readonly accepted: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  if (props.questionnaire?.consent.granted) return null;
  const pending = props.questionnaire?.consentTextStatus === 'pending_dpo_review';
  return (
    <div className="check">
      <input
        id="rl-consent"
        type="checkbox"
        checked={props.accepted}
        disabled={pending}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <label htmlFor="rl-consent">
        {pending
          ? 'Текст согласия ожидает проверки и пока не может быть принят.'
          : 'Даю согласие на обработку данных о мобильности для раздела «Релокация»: видите только вы, отзыв согласия удаляет данные.'}
      </label>
    </div>
  );
}

export function useConsentGate(questionnaire: RelocationQuestionnaireResponse | null) {
  const granted = Boolean(questionnaire?.consent.granted);
  const [accepted, setAccepted] = useState(granted);
  return { accepted: granted || accepted, setAccepted, ensure: () => ensureConsent(questionnaire) };
}

function FamilyFields(props: {
  readonly value: Family;
  readonly onChange: (next: Family) => void;
}) {
  const { value, onChange } = props;
  return (
    <>
      <div className="chips" role="group" aria-label="Кто едет">
        {[
          [false, 'Только я'],
          [true, 'Я и партнёр'],
        ].map(([partner, label]) => (
          <button
            className="chip"
            type="button"
            key={String(label)}
            aria-pressed={value.partner === partner}
            onClick={() => onChange({ ...value, partner: Boolean(partner) })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="rl-children">Детей</label>
        <input
          id="rl-children"
          className="num"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_CHILDREN}
          value={value.children}
          onChange={(event) =>
            onChange({
              ...value,
              children: Math.min(MAX_CHILDREN, Math.max(0, Number(event.target.value) || 0)),
            })
          }
        />
      </div>
    </>
  );
}

function useWhoSave(questionnaire: RelocationQuestionnaireResponse | null, done: () => void) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const consent = useConsentGate(questionnaire);
  const run = async (value: Family) => {
    setBusy(true);
    setFailed(false);
    try {
      const fresh = await consent.ensure();
      if (fresh.profile) await saveFamily(fresh.profile, value);
      done();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return { busy, failed, consent, run };
}

/** «Кто едет»: партнёр и дети; ответ уходит в анкету релокации и в расчёт трат. */
export function RelocationWhoDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly questionnaire: RelocationQuestionnaireResponse | null;
  readonly family: Family | null;
  readonly onSaved: () => void;
}) {
  const [value, setValue] = useState<Family>(props.family ?? { partner: false, children: 0 });
  const save = useWhoSave(props.questionnaire, () => {
    props.onSaved();
    props.onClose();
  });
  const { consent, busy, failed } = save;
  const footer = (
    <>
      <Button
        variant="primary"
        icon="check"
        busy={busy}
        disabled={!consent.accepted}
        onClick={() => void save.run(value)}
      >
        Сохранить
      </Button>
      <Button variant="quiet" onClick={props.onClose}>
        Отмена
      </Button>
    </>
  );
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Кто едет" footer={footer}>
      <FamilyFields value={value} onChange={setValue} />
      <ConsentCheck
        questionnaire={props.questionnaire}
        accepted={consent.accepted}
        onChange={consent.setAccepted}
      />
      {failed ? <StatusLine state="err" text="Не сохранилось. Попробуйте ещё раз." /> : null}
    </Dialog>
  );
}
