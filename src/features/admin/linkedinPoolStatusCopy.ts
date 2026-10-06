import type { LinkedinPoolAccount } from './linkedinPoolApi';

export function adminLinkedinFailureCopy(code: LinkedinPoolAccount['lastFailureCode']): string | null {
  switch (code) {
    case 'challenge_required':
      return 'Исполнитель остановлен: LinkedIn запросил проверку. Завершите её вручную.';
    case 'platform_restricted':
      return 'Исполнитель остановлен: LinkedIn ограничил запрос. Проверьте статус аккаунта вручную.';
    case 'unexpected_page':
      return 'Исполнитель остановлен: получена неожиданная страница LinkedIn. Проверьте её вручную.';
    case 'login_required':
      return 'Исполнитель остановлен: нужен ручной вход в LinkedIn.';
    case 'expired':
      return 'Исполнитель остановлен: сессия LinkedIn истекла. Выполните ручной вход.';
    case 'session_runtime_unavailable':
      return 'Окно ручного входа доступно только в приложении OpenQareer Desktop.';
    case 'provider_probe_unavailable':
      return 'Автоматическая проверка сессии пока недоступна. Откройте вход в отдельном окне ещё раз.';
    case 'provider_permission_required':
      return 'Источник LinkedIn отключён: для него нет разрешения провайдера.';
    case 'provider_probe_failed':
      return 'LinkedIn не подтвердил эту сессию. Повторите вход в отдельном окне.';
    default:
      return null;
  }
}
