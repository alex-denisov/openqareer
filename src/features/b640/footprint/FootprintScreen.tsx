import type { ReactNode } from 'react';
import { Button, StatusLine } from '../kit';
import type { B640Node } from '../routes';
import { pageAttrs } from './footprintModel';

import { SearchState, StartPanel } from './StartPanel';
import { SummaryView } from './SummaryView';
import { useFootprint, type FootprintData } from './useFootprint';

/** Ожидание и ошибка первого чтения — на месте экрана, с «Повторить». */
export function FootprintLoad({
  node,
  children,
}: {
  readonly node: B640Node;
  readonly children: (data: FootprintData, reload: () => void) => ReactNode;
}) {
  const load = useFootprint();
  if (load.state === 'loading') {
    return (
      <div className="page pf" {...pageAttrs(node)}>
        <div className="col"><StatusLine state="wait" text="Загружаем…" /></div>
      </div>
    );
  }
  if (load.state === 'error') {
    return (
      <div className="page pf" {...pageAttrs(node)}>
        <div className="col">
          <StatusLine state="err" text="Не удалось загрузить цифровой след."
            action={<Button size="sm" icon="repeat" onClick={load.retry}>Повторить</Button>} />
        </div>
      </div>
    );
  }
  return <>{children(load.data, load.retry)}</>;
}

/** Есть ли что показать в сводке: согласие дано и поиск закончен. */
export function hasSummary(data: FootprintData): boolean {
  return data.consentGranted && data.summary.state === 'ready';
}

/** F1: экран до поиска, во время поиска и после сбоя. */
export function StartPage({
  node, data, reload,
}: { readonly node: B640Node; readonly data: FootprintData; readonly reload: () => void }) {
  return (
    <div className="page pf" {...pageAttrs(node, 'f01')}>
      <SearchState data={data} onStarted={reload} />
      <div className="col">
        <StartPanel data={data} onStarted={reload} />
      </div>
    </div>
  );
}

/** P2 «Цифровой след» и F1 «до поиска»: до первой проверки, во время и после сбоя — F1. */
export function FootprintScreen({ node }: { readonly node: B640Node }) {
  return (
    <FootprintLoad node={node}>
      {(data, reload) =>
        node.code === 'p02' && hasSummary(data) ? (
          <SummaryView node={node} data={data} reload={reload} />
        ) : (
          <StartPage node={node} data={data} reload={reload} />
        )
      }
    </FootprintLoad>
  );
}
