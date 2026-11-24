import { buildNodePath } from '../routes';

/** Что открыто в панели: текущий разговор, записи на проверку, список разговоров или прошлый разговор. */
export type PanelView =
  /** `resumeFactId` — в разговоре готовая правка резюме из этого факта (K6). */
  | { readonly kind: 'dialog'; readonly resumeFactId?: string }
  | { readonly kind: 'review' }
  | { readonly kind: 'history' }
  | { readonly kind: 'conversation'; readonly id: string };

const CONVERSATION_PARAM = 'conversation';
const REVIEW_PARAM = 'review';
const RESUME_PARAM = 'resume';

/** Адрес вида панели: по нему панель открывается прямой ссылкой. */
export function panelPath(view: PanelView): string {
  if (view.kind === 'history') return buildNodePath('k05');
  const dialog = buildNodePath('k01');
  if (view.kind === 'review') return `${dialog}?${REVIEW_PARAM}=1`;
  if (view.kind === 'dialog') {
    return view.resumeFactId
      ? `${dialog}?${RESUME_PARAM}=${encodeURIComponent(view.resumeFactId)}`
      : dialog;
  }
  return `${dialog}?${CONVERSATION_PARAM}=${encodeURIComponent(view.id)}`;
}

/** Вид панели по узлу раздела «Консультант» и параметрам адреса. */
export function panelViewOf(code: string, search: string): PanelView {
  if (code === 'k05') return { kind: 'history' };
  const params = new URLSearchParams(search);
  const id = params.get(CONVERSATION_PARAM);
  if (id) return { kind: 'conversation', id };
  if (params.has(REVIEW_PARAM)) return { kind: 'review' };
  const resumeFactId = params.get(RESUME_PARAM);
  return resumeFactId ? { kind: 'dialog', resumeFactId } : { kind: 'dialog' };
}
