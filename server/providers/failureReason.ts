const MAX_REASON = 300;

/** Текст сбоя для журнала: одна строка, ключи и токены замаскированы, длина ограничена. */
export function maskFailureText(raw: string, maxLength = MAX_REASON): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/(bearer|basic)\s+\S+/gi, '$1 [masked]')
    .replace(/\b(sk|key|ya29|AIza|eyJ)[\w.-]{8,}/g, '[masked]')
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[masked]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[masked]')
    .slice(0, maxLength);
}

/** Сообщение из ответа провайдера с ошибкой: `error.message` JSON-а или начало тела. */
export async function providerFailureText(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string') message = parsed.error.message;
  } catch {
    // Не JSON: в журнал идёт начало тела.
  }
  return maskFailureText(`status ${response.status}: ${message}`);
}
