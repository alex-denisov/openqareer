import { useState } from 'react';
import type {
  FactCorrectionChange,
  FactCorrectionProposal,
} from '../../../../shared/factCorrection';
import { forgetSharedRead } from '../../resume/sharedRead';
import { Icon } from '../kit/Icon';
import { ResultLine } from '../kit/ResultLine';
import { PROFILE_CHANGED } from '../profile/ExperienceEditScreen';
import { correctFact, revertFactCorrection } from '../profile/factCorrectionApi';
import { ErrorRow } from './parts';

type State =
  | { readonly kind: 'ask' }
  | { readonly kind: 'declined' }
  | { readonly kind: 'applied'; readonly changes: readonly FactCorrectionChange[] };

function Diff({ before, after }: Pick<FactCorrectionProposal, 'before' | 'after'>) {
  const now = (
    <div className="now">
      <dt>Станет</dt>
      <dd>{after}</dd>
    </div>
  );
  return (
    <>
      <div className="only-desk">
        <dl className="ec-diff">
          <div className="was">
            <dt>Было</dt>
            <dd>{before}</dd>
          </div>
          {now}
        </dl>
      </div>
      <div className="only-mob">
        <dl className="ec-diff">{now}</dl>
        <details className="ec-was">
          <summary>
            <Icon name="down" />
            Показать, что было
          </summary>
          <p>{before}</p>
        </details>
      </div>
    </>
  );
}

interface AskProps {
  readonly proposal: FactCorrectionProposal;
  readonly busy: boolean;
  readonly onApply: () => void;
  readonly onDecline: () => void;
}

function Ask({ proposal, busy, onApply, onDecline }: AskProps) {
  return (
    <section className="ec" aria-label={`Правка резюме: ${proposal.place}`} aria-busy={busy}>
      <p className="ec-title">{proposal.place}</p>
      <Diff before={proposal.before} after={proposal.after} />
      <div className="msg-acts act-row ec-acts">
        <button className="btn is-sm is-primary" type="button" disabled={busy} onClick={onApply}>
          Применить
        </button>
        <button
          className="btn is-sm is-line ec-ib"
          type="button"
          aria-label="Отклонить"
          disabled={busy}
          onClick={onDecline}
        >
          <Icon name="close" />
          <span className="ec-ib-l">Отклонить</span>
          <span className="ec-tip" role="tooltip" aria-hidden="true">
            Отклонить
          </span>
        </button>
      </div>
    </section>
  );
}

/** K6: правка факта, которую кандидат назвал в разговоре; «Применено» — только после записи. */
export function FactCorrectionCard({ proposal }: { readonly proposal: FactCorrectionProposal }) {
  const [state, setState] = useState<State>({ kind: 'ask' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function run(work: () => Promise<State>, failure: string) {
    setBusy(true);
    setFailed(null);
    try {
      setState(await work());
      forgetSharedRead('resume');
      window.dispatchEvent(new Event(PROFILE_CHANGED));
    } catch {
      setFailed(failure);
    } finally {
      setBusy(false);
    }
  }
  const { target, before, after } = proposal;
  const apply = () =>
    void run(
      async () => ({
        kind: 'applied',
        changes: (await correctFact({ target, before, after })).changes,
      }),
      'Правка не применилась',
    );
  const undo = (changes: readonly FactCorrectionChange[]) =>
    void run(async () => {
      await revertFactCorrection(changes);
      return { kind: 'ask' };
    }, 'Не сохранилось');

  if (state.kind === 'declined') return null;
  return (
    <>
      {state.kind === 'applied' ? (
        <ResultLine text="Применено" onUndo={busy ? undefined : () => undo(state.changes)} />
      ) : (
        <Ask
          proposal={proposal}
          busy={busy}
          onApply={apply}
          onDecline={() => setState({ kind: 'declined' })}
        />
      )}
      {failed ? <ErrorRow text={failed} /> : null}
    </>
  );
}
