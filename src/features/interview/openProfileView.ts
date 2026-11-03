import { OPEN_VIEW_EVENT } from '../desktopNotify/openViewEvent';

/** «Открыть профиль» из итога: закрыть тренажёр и перейти в раздел «Профиль». */
export function openProfileView(closeTrainer: () => void): void {
  closeTrainer();
  window.dispatchEvent(new CustomEvent(OPEN_VIEW_EVENT, { detail: { view: 'profile' } }));
}
