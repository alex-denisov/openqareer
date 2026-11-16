import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { B640_HOME_PATH, buildNodePath } from '../routes';
import type { SectionProps } from '../sections';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { ConsultantPanel, type PanelView } from './ConsultantPanel';

const CONVERSATION_PARAM = 'conversation';

/** Адрес вида панели, пока она открывается адресом раздела «Консультант». */
export function panelPath(view: PanelView): string {
  if (view.kind === 'history') return buildNodePath('k05');
  const dialog = buildNodePath('k01');
  return view.kind === 'conversation'
    ? `${dialog}?${CONVERSATION_PARAM}=${encodeURIComponent(view.id)}`
    : dialog;
}

export function panelViewOf(code: string, search: string): PanelView {
  if (code === 'k05') return { kind: 'history' };
  const id = new URLSearchParams(search).get(CONVERSATION_PARAM);
  return id ? { kind: 'conversation', id } : { kind: 'dialog' };
}

/**
 * Вход раздела «Консультант»: узлы k01 (разговор) и k05 (все разговоры).
 * В макете консультант — панель рядом с `main`, поэтому она встаёт в сетку `.app`,
 * а не внутрь страницы. Над каким разделом открыть панель, решает оболочка: она может
 * поставить `ConsultantPanel` сама, с темой своего раздела.
 */
export default function Section({ node }: SectionProps) {
  const { navigate, search } = useShell();
  const [grid, setGrid] = useState<Element | null>(null);
  const findGrid = useCallback((anchor: HTMLElement | null) => {
    setGrid(anchor ? anchor.closest('.app') : null);
  }, []);
  useScreenChrome({ hasPanel: true, rootData: { dialog: '1' } });
  const view = panelViewOf(node.code, search);

  return (
    <div className="page" data-b640-node={node.code} data-b640-section={node.section} ref={findGrid}>
      {grid
        ? createPortal(
            <ConsultantPanel
              view={view}
              stage="today"
              named={false}
              pathOf={panelPath}
              onView={(next) => navigate(panelPath(next))}
              onClose={() => navigate(B640_HOME_PATH)}
            />,
            grid,
          )
        : null}
    </div>
  );
}
