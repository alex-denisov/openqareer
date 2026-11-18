import { buildNodePath } from '../routes';

/** Что открыто в панели: текущий разговор, записи на проверку, список разговоров или прошлый разговор. */
export type PanelView =
  | { readonly kind: 'dialog' }
  | { readonly kind: 'review' }
  | { readonly kind: 'history' }
  | { readonly kind: 'conversation'; readonly id: string };

const CONVERSATION_PARAM = 'conversation';
const REVIEW_PARAM = 'review';

/** Адрес вида панели: по нему панель открывается прямой ссылкой. */
export function panelPath(view: PanelView): string {
  if (view.kind === 'history') return buildNodePath('k05');
  const dialog = buildNodePath('k01');
  if (view.kind === 'review') return `${dialog}?${REVIEW_PARAM}=1`;
  return view.kind === 'conversation'
    ? `${dialog}?${CONVERSATION_PARAM}=${encodeURIComponent(view.id)}`
    : dialog;
}

/** Вид панели по узлу раздела «Консультант» и параметрам адреса. */
export function panelViewOf(code: string, search: string): PanelView {
  if (code === 'k05') return { kind: 'history' };
  const params = new URLSearchParams(search);
  const id = params.get(CONVERSATION_PARAM);
  if (id) return { kind: 'conversation', id };
  return params.has(REVIEW_PARAM) ? { kind: 'review' } : { kind: 'dialog' };
}
