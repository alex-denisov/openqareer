import type { ApplicationView } from './applicationsApi';
import {
  checkActionCapacity,
  type CandidateActionKind,
  type CandidateActionUsageSummary,
  isAllowedCandidateActionTarget,
} from '../../../shared/candidateActionPolicy';

export interface SelectableActionApplication {
  readonly application: ApplicationView;
  readonly platform: 'hh' | 'linkedin';
  readonly actionKind: CandidateActionKind;
  readonly targetUrl: string;
}

export function getSelectableActionApplications(
  applications: readonly ApplicationView[],
): SelectableActionApplication[] {
  const result: SelectableActionApplication[] = [];
  for (const application of applications) {
    if (application.stage !== 'saved' || !application.vacancy?.url) continue;
    const platform = isAllowedCandidateActionTarget('hh', application.vacancy.url)
      ? 'hh'
      : isAllowedCandidateActionTarget('linkedin', application.vacancy.url)
        ? 'linkedin'
        : null;
    if (!platform) continue;
    result.push({
      application,
      platform,
      actionKind: platform === 'hh' ? 'hh_apply' : 'linkedin_easy_apply',
      targetUrl: application.vacancy.url,
    });
  }
  return result;
}

export function getActionLimitMessage(input: {
  readonly actions: readonly { actionKind: CandidateActionKind }[];
  readonly usage: CandidateActionUsageSummary;
  readonly timezone: string;
  readonly now: Date;
  readonly resetAt: string;
}): string | null {
  let usage = input.usage;
  for (const action of input.actions) {
    const verdict = checkActionCapacity(action.actionKind, input.now, input.timezone, usage);
    if (!verdict.allowed) {
      return verdict.code === 'quiet_hours'
        ? 'Действия приостановлены на время тихих часов.'
        : `${verdict.message ?? 'Лимит действий исчерпан.'} Сброс: ${formatActionReset(input.resetAt, input.timezone)}.`;
    }
    usage = incrementUsage(usage, action.actionKind, input.now.toISOString());
  }
  return null;
}

export function formatActionReset(resetAt: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(resetAt));
  } catch {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(resetAt));
  }
}

export function actionStatusLabel(status: 'pending' | 'delivered' | 'attempted' | 'failed'): string {
  if (status === 'pending') return 'Выполняется';
  if (status === 'delivered') return 'Доставлено';
  if (status === 'attempted') return 'Не подтверждено';
  return 'Не удалось';
}

export function formatActionCount(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14
    ? 'действий'
    : last === 1
      ? 'действие'
      : last >= 2 && last <= 4
        ? 'действия'
        : 'действий';
  return `${count} ${word}`;
}

export function actionFailureLabel(code?: string | null): string {
  const copy: Record<string, string> = {
    action_limit_reached: 'Лимит исчерпан. Дождитесь сброса, чтобы продолжить.',
    already_applied_unverified: 'Площадка уже показывает отклик. Новое действие не выполнялось.',
    approved_resume_missing: 'Не найдено выбранное резюме. Проверьте его в сессии площадки.',
    batch_stopped: 'Пакет остановлен после предыдущего действия.',
    candidate_input_required: 'Площадка запросила ответ, который нужно заполнить вручную.',
    challenge_required: 'Площадка запросила проверку безопасности. Пройдите её вручную.',
    http_403: 'Площадка отказала в действии. Пакет остановлен.',
    kill_switch_active: 'Действия остановлены переключателем остановки.',
    letter_required: 'Добавьте и проверьте текст письма.',
    login_required: 'Войдите в свою сессию площадки и повторите позже.',
    platform_unavailable: 'Площадка сейчас недоступна. Повторите попытку позже.',
    provider_confirmation_missing: 'Площадка не подтвердила результат. Повторного нажатия не было.',
    resume_selection_required: 'Нужно выбрать одно резюме в сессии площадки.',
    session_identity_unverified: 'Не удалось проверить, что открыта ваша сессия площадки.',
    session_expired: 'Сессия площадки завершилась. Войдите в неё снова.',
    target_redirect_rejected: 'Переход на другой адрес остановлен.',
    target_not_allowed: 'Ссылка не относится к выбранной площадке.',
  };
  return (code && copy[code]) || 'Результат действия не подтверждён площадкой.';
}

function incrementUsage(
  usage: CandidateActionUsageSummary,
  actionKind: CandidateActionKind,
  at: string,
): CandidateActionUsageSummary {
  if (actionKind === 'hh_apply') return { ...usage, hhAppliesCount: usage.hhAppliesCount + 1 };
  if (actionKind === 'linkedin_easy_apply') {
    return { ...usage, linkedinEasyAppliesCount: usage.linkedinEasyAppliesCount + 1 };
  }
  return { ...usage, hhBoostsCount: usage.hhBoostsCount + 1, lastHhBoostAt: at };
}
