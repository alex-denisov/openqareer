import type { FootprintRiskItem } from '../../../../shared/footprintRisk';
import { FOOTPRINT_CATEGORY_TITLES } from '../../../../shared/footprintRisk';
import { Button, Icon, Link, StatusLine, useToast } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { useReview } from './FindingRow';
import { FootprintLoad, StartPage, hasSummary } from './FootprintScreen';
import {
  GOOGLE_REMOVAL_URL,
  YANDEX_REMOVAL_URL,
  letterText,
  mailtoHref,
  openRisks,
  pageAttrs,
  shortDate,
} from './footprintModel';
import type { FootprintData } from './useFootprint';
import { repeatIds, useStartSearch } from './useStartSearch';
import { reportFailure } from './reportFailure';

interface ViewProps {
  readonly data: FootprintData;
  readonly item: FootprintRiskItem;
  readonly reload: () => void;
}

function Facts({ item }: { readonly item: FootprintRiskItem }) {
  return (
    <dl className="kv fp-kv">
      {item.detail ? (<><dt>Где</dt><dd>{item.detail}</dd></>) : null}
      {item.mismatch ? (
        <>
          <dt>Что видно</dt>
          <dd>{item.mismatch.field}: «{item.mismatch.foundValue}», в профиле — «{item.mismatch.profileValue}»</dd>
        </>
      ) : null}
      {item.levelLabel ? (<><dt>Риск</dt><dd>{item.levelLabel}</dd></>) : null}
    </dl>
  );
}

function QuietRow({ item, onDone }: { readonly item: FootprintRiskItem; readonly onDone: () => void }) {
  const review = useReview(onDone);
  const { findingId } = item;
  if (!findingId) return null;
  return (
    <>
      <div className="actions fp-quiet-row">
        <button className="row-act" type="button"
          onClick={() => void review.mark(findingId, 'hidden', 'Отмечено: не проблема')}>
          Это не проблема
        </button>
        <button className="row-act" type="button"
          onClick={() => void review.mark(findingId, 'not_self', 'Отмечено: это не вы')}>
          Это не я
        </button>
      </div>
      {review.error ? <StatusLine state="err" text={review.error} /> : null}
    </>
  );
}

function Letter({ item }: { readonly item: FootprintRiskItem }) {
  const toast = useToast();
  const text = letterText(item);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ text: 'Письмо скопировано' });
    } catch (reason) {
      reportFailure('письмо не скопировалось', reason);
      toast.show({ text: 'Не удалось скопировать. Выделите текст вручную.' });
    }
  }

  return (
    <div className="fp-letter-w">
      <blockquote className="fp-letter" id="fp-letter">
        <p className="fp-clamp">{text}</p>
      </blockquote>
      <button className="icon-btn li-copy fp-copy" type="button" aria-label="Скопировать письмо"
        aria-controls="fp-letter" onClick={() => void copy()}>
        <Icon name="copy" />
      </button>
    </div>
  );
}

function ExternalRow({ item }: { readonly item: FootprintRiskItem }) {
  return (
    <div className="actions fp-ext-row">
      <a className="btn fp-ext" href={mailtoHref(item)} aria-label="Письмо сайту">
        <Icon name="mail" />
        Письмо сайту
      </a>
      <a className="btn fp-ext" href={GOOGLE_REMOVAL_URL} rel="noopener noreferrer" target="_blank"
        aria-label="Google: «Результаты с вашими данными», откроется в новой вкладке">
        Google
        <Icon name="out" />
      </a>
      <a className="btn fp-ext" href={YANDEX_REMOVAL_URL} rel="noopener noreferrer" target="_blank"
        aria-label="Яндекс: удаление по запросам с именем, откроется в новой вкладке">
        Яндекс
        <Icon name="out" />
      </a>
    </div>
  );
}

/** «Проверено DD.MM · Проверить снова»: новая проверка, ход виден в «Цифровом следе». */
function RecheckDock({ data }: { readonly data: FootprintData }) {
  const { navigate } = useShell();
  const repeat = useStartSearch(data, () => navigate(buildNodePath('p02')));
  const checked = shortDate(data.summary.checkedAt);
  return (
    <>
      {repeat.error ? <StatusLine state="err" text={repeat.error} /> : null}
      <div className="fp-dock fp-dock-ico">
        {checked ? <span className="fp-dock-d">Проверено <span className="num">{checked}</span></span> : null}
        <Button variant="primary" icon="refresh" busy={repeat.busy}
          onClick={() => void repeat.start(repeatIds(data))}>
          Проверить снова
        </Button>
      </div>
    </>
  );
}

function Finding({ data, item, reload }: ViewProps) {
  const { navigate } = useShell();
  useScreenChrome({ crumb: item.title });
  const risks = openRisks(data.summary);
  const index = risks.findIndex((entry) => entry.id === item.id);
  const position = index >= 0 ? `Находка ${index + 1} из ${risks.length} · ` : '';
  const toSummary = () => {
    reload();
    navigate(buildNodePath('f03'));
  };
  return (
    <section className="lead" aria-labelledby="pf-t">
      <h2 className="lead-title is-long" id="pf-t">{item.title}</h2>
      <p className="lead-sub">{position}{FOOTPRINT_CATEGORY_TITLES[item.category].toLowerCase()}</p>
      <Facts item={item} />
      <QuietRow item={item} onDone={toSummary} />
      <Letter item={item} />
      <ExternalRow item={item} />
      <RecheckDock data={data} />
    </section>
  );
}

function Missing() {
  return (
    <section className="lead" aria-labelledby="pf-t">
      <h2 className="lead-title is-long" id="pf-t">Находки больше нет</h2>
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('f03')}>
          <Icon name="list" />
          К сводке
        </Link>
      </div>
    </section>
  );
}

/** F3б: одна находка и путь удаления — письмо сайту, формы поисковиков, повторная проверка. */
export function FindingScreen({ node, findingId }: { readonly node: B640Node; readonly findingId: string }) {
  return (
    <FootprintLoad node={node}>
      {(data, reload) => {
        if (!hasSummary(data)) return <StartPage node={node} data={data} reload={reload} />;
        const item = data.summary.items.find((entry) => entry.id === findingId);
        return (
          <div className="page pf" {...pageAttrs(node)}>
            <div className="col">
              {item ? <Finding data={data} item={item} reload={reload} /> : <Missing />}
            </div>
          </div>
        );
      }}
    </FootprintLoad>
  );
}
