import { CoachApiError } from '../coach/apiClient';
import type { RemoteLoginFrame, RemoteLoginReason } from './linkedinRemoteLoginApi';

export interface PagePoint {
  x: number;
  y: number;
}

interface ImageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Переводит точку клика по уменьшенной картинке в координаты страницы. */
export function frameToPagePoint(
  click: { clientX: number; clientY: number },
  box: ImageBox,
  page: { width: number; height: number },
): PagePoint | null {
  if (box.width <= 0 || box.height <= 0 || page.width <= 0 || page.height <= 0) return null;
  const x = Math.round(((click.clientX - box.left) / box.width) * page.width);
  const y = Math.round(((click.clientY - box.top) / box.height) * page.height);
  return {
    x: Math.min(Math.max(x, 0), page.width - 1),
    y: Math.min(Math.max(y, 0), page.height - 1),
  };
}

const CLOSE_REASONS: Record<RemoteLoginReason, string> = {
  closed_by_admin: 'Закрыто администратором',
  idle: 'Закрыто после 10 минут простоя',
  persist_failed: 'Закрыто: не удалось сохранить сессию на сервере',
  shutdown: 'Закрыто: сервер перезапускается',
};

export function remoteLoginStatusText(
  frame: Pick<RemoteLoginFrame, 'state' | 'reason'> | undefined,
): string {
  if (!frame) return 'Подключаемся к браузеру сервера…';
  switch (frame.state) {
    case 'login':
      return 'Страница входа LinkedIn';
    case 'checkpoint':
      return 'LinkedIn просит проверку — пройдите её здесь';
    case 'signed_in':
      return 'Вход выполнен, сессия сохранена на сервере';
    case 'closed':
      return frame.reason ? CLOSE_REASONS[frame.reason] : 'Окно закрыто';
  }
}

const ERROR_COPY: Record<string, string> = {
  remote_login_already_active: 'Для этого аккаунта вход в браузере сервера уже открыт.',
  linkedin_profile_busy: 'Профиль аккаунта занят другой операцией. Повторите чуть позже.',
  remote_login_closed: 'Окно входа уже закрыто. Откройте его заново.',
  linkedin_account_not_loginable: 'В этот аккаунт нельзя войти: он отозван или отключён.',
  remote_login_rate_limited: 'Слишком много попыток. Подождите и повторите.',
  remote_login_unavailable: 'Браузер на сервере сейчас недоступен.',
  remote_login_not_found: 'Окно входа не найдено: оно закрыто или сервер перезапущен.',
};

export function remoteLoginErrorText(reason: unknown): string {
  if (reason instanceof CoachApiError) {
    return ERROR_COPY[reason.code] ?? reason.message;
  }
  return 'Не удалось связаться с сервером. Проверьте соединение и повторите.';
}

/** Коды, после которых опрос кадра бессмыслен. */
export function isRemoteLoginGone(reason: unknown): boolean {
  return (
    reason instanceof CoachApiError &&
    (reason.code === 'remote_login_not_found' || reason.code === 'remote_login_closed')
  );
}
