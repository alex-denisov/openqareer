import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** Всё в корне, кроме окна, фона и тоста, делается `inert`; возвращает отмену. */
function isolate(root: HTMLElement, keep: readonly (HTMLElement | null)[]): () => void {
  const changed = Array.from(root.children).filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement &&
      !keep.includes(node) &&
      !node.hasAttribute('data-kit-keep') &&
      !node.hasAttribute('inert'),
  );
  changed.forEach((node) => node.setAttribute('inert', ''));
  return () => changed.forEach((node) => node.removeAttribute('inert'));
}

/** Tab по кругу внутри окна. */
function trapTab(event: KeyboardEvent, dialog: HTMLElement): void {
  const items = focusables(dialog);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Открытые окна в порядке открытия; последнее — верхнее. */
const OPEN_DIALOGS: HTMLElement[] = [];

/** Открыто ли сейчас модальное окно: тост в это время на Esc не реагирует. */
export function hasOpenModal(): boolean {
  return OPEN_DIALOGS.length > 0;
}

export interface ModalFocusRefs {
  readonly host: HTMLElement | null;
  readonly dialog: RefObject<HTMLDivElement>;
  readonly back: RefObject<HTMLDivElement>;
}

/**
 * Окно открыто: фокус внутрь, остальное `inert`, Tab по кругу, Esc закрывает;
 * при закрытии фокус возвращается на открывшую кнопку.
 */
export function useModalFocus(shown: boolean, refs: ModalFocusRefs, onClose: () => void): void {
  const { host, dialog: dialogRef, back } = refs;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!shown || !host || !dialog) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = isolate(host, [dialog, back.current]);
    const body = dialog.querySelector<HTMLElement>('.pf-db');
    ((body ? focusables(body)[0] : undefined) ?? dialog).focus();
    OPEN_DIALOGS.push(dialog);
    // Клавиши слушает только верхнее окно: Esc не закрывает сразу все вложенные.
    const onKey = (event: KeyboardEvent) => {
      if (OPEN_DIALOGS[OPEN_DIALOGS.length - 1] !== dialog) return;
      if (event.key === 'Escape') closeRef.current();
      else if (event.key === 'Tab') trapTab(event, dialog);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      OPEN_DIALOGS.splice(OPEN_DIALOGS.indexOf(dialog), 1);
      document.removeEventListener('keydown', onKey);
      release();
      opener?.focus();
    };
  }, [shown, host, dialogRef, back]);
}
