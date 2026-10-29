import { CoachApiError } from '../coach/apiClient';

export type ProfileFailureAction = 'save' | 'load';

const FIELD_LABELS: Readonly<Record<string, string>> = {
  fullName: 'Имя',
  headline: 'Роль',
  location: 'Город',
  email: 'Email',
  phone: 'Телефон',
  telegram: 'Telegram',
};

const NETWORK = {
  save: 'Не сохранилось: нет связи с сервером. Текст остался в поле.',
  load: 'Не удалось загрузить профиль: нет связи с сервером. Проверьте соединение и повторите запрос.',
} as const;
const SERVER = {
  save: 'Не сохранилось: сервер временно не отвечает. Текст остался в поле, попробуйте ещё раз.',
  load: 'Не удалось загрузить профиль: сервер временно не отвечает. Повторите запрос чуть позже.',
} as const;

function failedFieldLabels(reason: CoachApiError): readonly string[] {
  const labels = Object.keys(reason.fields)
    .map((key) => FIELD_LABELS[key.split('.').at(-1) ?? ''])
    .filter((label): label is string => Boolean(label));
  return [...new Set(labels)];
}

/**
 * One place that turns a failed profile request into plain Russian. The text
 * the server sent is never shown: it can be English, technical or a stack
 * line (walk 29.10, A7/A8). Only the kind of failure picks the sentence.
 */
export function profileFailureText(reason: unknown, action: ProfileFailureAction): string {
  if (!(reason instanceof CoachApiError)) return NETWORK[action];
  if (reason.code === 'validation_failed' || reason.code === 'invalid_request') {
    const labels = failedFieldLabels(reason);
    if (action === 'load') return SERVER.load;
    const which =
      labels.length === 1
        ? `проверьте поле «${labels[0]}»`
        : labels.length > 1
          ? `проверьте поля ${labels.map((label) => `«${label}»`).join(', ')}`
          : 'проверьте заполненные поля';
    return `Не сохранилось: ${which}. Текст остался в поле.`;
  }
  if (reason.retryable || /^http_5/u.test(reason.code)) return SERVER[action];
  return NETWORK[action];
}
