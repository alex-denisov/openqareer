import { buildNodePath } from '../routes';

/** Что открыто в панели: текущий разговор, список разговоров или прошлый разговор. */
export type PanelView =
  | { readonly kind: 'dialog' }
  | { readonly kind: 'history' }
  | { readonly kind: 'conversation'; readonly id: string };

const CONVERSATION_PARAM = 'conversation';

/** Адрес вида панели: по нему панель открывается прямой ссылкой. */
export function panelPath(view: PanelView): string {
  if (view.kind === 'history') return buildNodePath('k05');
  const dialog = buildNodePath('k01');
  return view.kind === 'conversation'
    ? `${dialog}?${CONVERSATION_PARAM}=${encodeURIComponent(view.id)}`
    : dialog;
}

/** Вид панели по узлу раздела «Консультант» и параметрам адреса. */
export function panelViewOf(code: string, search: string): PanelView {
  if (code === 'k05') return { kind: 'history' };
  const id = new URLSearchParams(search).get(CONVERSATION_PARAM);
  return id ? { kind: 'conversation', id } : { kind: 'dialog' };
}
