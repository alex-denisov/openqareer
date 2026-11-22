import { useEffect, useState } from 'react';
import type { CareerDiaryKpiImport } from '../../../../shared/careerDiaryKpi';
import { ActionDock } from '../kit/ActionDock';
import { Button } from '../kit/Button';
import { Icon } from '../kit/Icon';
import { InfoTip } from '../kit/InfoTip';
import { StatusLine } from '../kit/ResultLine';
import { useToast } from '../kit/Toast';
import { useIsMobile } from '../kit/useMediaQuery';
import { buildNodePath, type B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import { Link } from '../shell/Link';
import { acceptKpiImport, getKpiImport } from './diaryApi';
import { KpiMobileList } from './KpiMobileList';
import { KpiTable } from './KpiTable';
import { KpiSourceDelete } from './KpiSourceDelete';
import { acceptRows, draftRows, sourceLine, weightLine, type KpiDraftRow } from './kpiModel';
import { today } from './model';
import { RetryButton } from './parts';
import './diary.css';

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly draft: CareerDiaryKpiImport };

function useDraft(id: string | null): [Loaded, () => void] {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    let active = true;
    getKpiImport(id).then(
      (draft) => active && setLoaded({ state: 'ready', draft }),
      () => active && setLoaded({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);
  return [loaded, () => (setLoaded({ state: 'loading' }), setAttempt((value) => value + 1))];
}

function useAccept(draft: CareerDiaryKpiImport) {
  const { navigate } = useShell();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [sum, setSum] = useState<string | null>(null);
  async function accept(rows: readonly KpiDraftRow[]) {
    const result = acceptRows(rows, today());
    setErrors('errors' in result ? result.errors : {});
    setSum('sum' in result ? result.sum : null);
    if (!('rows' in result)) return;
    setBusy(true);
    setFailed(false);
    try {
      const { goalIds } = await acceptKpiImport(draft.id, { rows: result.rows });
      toast.show({ text: `Добавлено целей: ${goalIds.length}` });
      navigate(buildNodePath('d02'));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return { busy, failed, errors, sum, accept };
}

function ReviewForm({ draft }: { readonly draft: CareerDiaryKpiImport }) {
  const [rows, setRows] = useState<readonly KpiDraftRow[]>(() => draftRows(draft));
  const { busy, failed, errors, sum, accept } = useAccept(draft);
  const mobile = useIsMobile();
  const chosen = rows.filter((row) => row.ok).length;
  const change = (id: string, patch: Partial<KpiDraftRow>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <form className="kp-foot" onSubmit={(event) => (event.preventDefault(), void accept(rows))}>
      {mobile ? (
        <KpiMobileList draft={draft} rows={rows} errors={errors} onChange={change} />
      ) : (
        <KpiTable rows={rows} errors={errors} onChange={change} />
      )}
      {sum ? (
        <p className="va-err" role="alert">
          {sum}
        </p>
      ) : null}
      {failed ? (
        <StatusLine state="err" text="Цели не добавились" action={<RetryButton submit />} />
      ) : null}
      {/* Как в макете d02l: сначала «Принять», за ней «Загрузить заново» (только 1440/1176). */}
      <ActionDock
        kind="commit"
        primary={
          <>
            <Button
              variant="primary"
              icon="checkc"
              type="submit"
              busy={busy}
              disabled={chosen === 0}
            >
              {`Принять ${chosen}`}
            </Button>
            {mobile ? null : (
              <Link className="btn" to={buildNodePath('d02k')}>
                <Icon name="repeat" />
                Загрузить заново
              </Link>
            )}
          </>
        }
      />
      <KpiSourceDelete draft={draft} />
    </form>
  );
}

function Lead({ draft }: { readonly draft: CareerDiaryKpiImport }) {
  const rows = draftRows(draft);
  const weights = weightLine(rows);
  return (
    <div className="lead-head">
      <h2 className="lead-title" id="kp-title">
        Проверьте, как мы поняли
      </h2>
      <InfoTip
        label="Откуда показатели"
        text={[sourceLine(draft), `Показателей: ${rows.length}.`, weights ? `${weights}.` : null]
          .filter(Boolean)
          .join(' ')}
      />
    </div>
  );
}

/** Экран d02l «Проверьте, как мы поняли»: черновик из d02k правится и принимается целями. */
export function KpiReviewScreen({ node }: { readonly node: B640Node }) {
  const { search, navigate } = useShell();
  const id = new URLSearchParams(search).get('import');
  const [loaded, retry] = useDraft(id);
  // Без черновика проверять нечего: прямая ссылка или «Назад» ведут на загрузку. Смотрим
  // только адрес при открытии: после «Принять» экран уходит на d02 и теряет ?import.
  const [missing] = useState(() => !id);
  useEffect(() => {
    if (missing) navigate(buildNodePath('d02k'));
  }, [missing, navigate]);
  const mobile = useIsMobile();
  return (
    <div className="page gb-page kd-page" data-b640-node={node.code} data-b640-section={node.section}>
      {loaded.state === 'ready' && !mobile ? <Lead draft={loaded.draft} /> : null}
      {loaded.state === 'loading' ? <StatusLine state="wait" text="Загружаем показатели" /> : null}
      {loaded.state === 'error' ? (
        <StatusLine
          state="err"
          text="Показатели не загрузились"
          action={<RetryButton onClick={retry} />}
        />
      ) : null}
      {loaded.state === 'ready' ? <ReviewForm draft={loaded.draft} /> : null}
    </div>
  );
}
