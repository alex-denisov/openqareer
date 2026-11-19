import { useState } from 'react';
import type { FootprintRiskItem } from '../../../../shared/footprintRisk';
import { CoachApiError } from '../../coach/apiClient';
import { Button, Icon, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { useShell } from '../shell/ShellContext';
import { markRemovalRequested, recheckFinding } from './footprintApi';
import { shortDate } from './footprintModel';
import { removalDock, removalDone, removalNote } from './removalModel';
import { reportFailure } from './reportFailure';
import type { FootprintData } from './useFootprint';
import { repeatIds, useStartSearch } from './useStartSearch';

interface DockProps {
  readonly data: FootprintData;
  readonly item: FootprintRiskItem;
  readonly reload: () => void;
}

function failureText(reason: unknown, fallback: string): string {
  return reason instanceof CoachApiError && reason.message ? reason.message : fallback;
}

function useRemovalAction(reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
    } catch (reason) {
      reportFailure(fallback, reason);
      setError(failureText(reason, fallback));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** «Проверено DD.MM · Проверить снова»: новая проверка всего следа, ход виден в «Цифровом следе». */
function RerunDock({ data, note }: { readonly data: FootprintData; readonly note: string | null }) {
  const { navigate } = useShell();
  const repeat = useStartSearch(data, () => navigate(buildNodePath('p02')));
  const checked = shortDate(data.summary.checkedAt);
  return (
    <>
      {repeat.error ? <StatusLine state="err" text={repeat.error} /> : null}
      <div className="fp-dock fp-dock-ico">
        {note ? (
          <span className="fp-dock-d">{note}</span>
        ) : checked ? (
          <span className="fp-dock-d">
            Проверено <span className="num">{checked}</span>
          </span>
        ) : null}
        <Button
          variant="primary"
          icon="refresh"
          busy={repeat.busy}
          onClick={() => void repeat.start(repeatIds(data))}
        >
          Проверить снова
        </Button>
      </div>
    </>
  );
}

/** B382: нижняя панель f03b — «Письмо отправлено», затем проверка этой находки. */
export function FindingDock({ data, item, reload }: DockProps) {
  const action = useRemovalAction(reload);
  const step = removalDock(item);
  const note = removalNote(item.removal);
  const findingId = item.findingId;
  if (step === 'rerun' || !findingId) return <RerunDock data={data} note={note} />;
  return (
    <>
      {action.error ? <StatusLine state="err" text={action.error} /> : null}
      {step === 'request' ? (
        <div className="fp-dock">
          <Button
            variant="primary"
            icon="send"
            busy={action.busy}
            onClick={() =>
              void action.run(() => markRemovalRequested(findingId), 'Не удалось отметить письмо.')
            }
          >
            Письмо отправлено
          </Button>
        </div>
      ) : (
        <div className="fp-dock fp-dock-ico">
          {note ? <span className="fp-dock-d">{note}</span> : null}
          <Button
            variant="primary"
            icon="refresh"
            busy={action.busy}
            onClick={() =>
              void action.run(() => recheckFinding(findingId), 'Не удалось проверить находку.')
            }
          >
            Проверить находку
          </Button>
        </div>
      )}
    </>
  );
}

/** «Удалено · проверено DD.MM» над находкой, когда проверка не нашла страницу. */
export function RemovalDoneLine({ item }: { readonly item: FootprintRiskItem }) {
  const done = removalDone(item.removal);
  if (!done) return null;
  return (
    <p className="pf-done c6-res fp-state" role="status">
      <Icon name="checkc" />
      Удалено · проверено <span className="num">{done}</span>
    </p>
  );
}
