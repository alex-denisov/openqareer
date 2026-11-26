import { createPlanRequest, listPlanRequests } from '../../shell/planRequestApi';
import { Icon } from '../kit/Icon';
import { useState } from 'react';
import { ErrorLine, useLoad } from './parts';

async function consultantRequested(): Promise<boolean> {
  const requests = await listPlanRequests();
  return requests.some((request) => request.planId === 'consultant');
}

/**
 * «Живой консультант»: только заявка (решение владельца 16.11) — кнопка и «Заявка отправлена»
 * на её месте. Разметка `span.req` из макетов T1 и T3.
 */
export function LiveConsultantRequest() {
  const load = useLoad(consultantRequested);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sent = load.state === 'ready' && load.data;
  async function send() {
    setBusy(true);
    setFailed(false);
    try {
      await createPlanRequest('consultant');
      load.replace(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className={sent ? 'req is-sent' : 'req'}>
        {sent ? (
          <span className="req-done" role="status">
            <Icon name="check" />
            Заявка отправлена
          </span>
        ) : (
          <button className="btn req-btn" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void send()}>
            <Icon name="mail" />
            Оставить заявку
          </button>
        )}
      </span>
      {failed ? <ErrorLine text="Заявка не отправилась" /> : null}
    </>
  );
}

export const LIVE_CONSULTANT_PRICE = '5 000 ₽ в час';
