/**
 * B682: «Другой вариант» (LinkedIn, правки hh.ru, пункты k06). Прод 24.11: ответ модели отклонила проверка
 * (`unknown_fact`), и кандидат сразу увидел отказ, хотя повтор проходил. Теперь отклонённый ответ
 * возвращается модели с причиной, и только потом кандидат видит отказ. Сами проверки те же.
 */
export interface RejectedVariant {
  readonly text: string;
  /** Указание модели, что исправить. */
  readonly reason: string;
}

/** Вход модели, которому к повтору добавляется отклонённый ответ. */
export interface RetryableVariantRequest {
  readonly rejected?: RejectedVariant;
}

/** Абзац общих правил промпта варианта. */
export const REJECTED_VARIANT_RULE =
  '- Если есть rejected: прошлый ответ (rejected.text) не прошёл проверку. Напиши заново и исправь то, что названо в rejected.reason; остальные правила те же.';

/** Код причины → одна фраза модели. Коды без текста кандидата, они же идут в журнал. */
const REASON_TEXT = {
  empty: 'Текст пустой: напиши сам вариант.',
  too_long: 'Текст слишком длинный: уложись в предел знаков.',
  link: 'Убери ссылки, адреса почты и разметку.',
  unknown_fact: 'В factIds только id из facts, посимвольно; других id не бывает (targetRole и label — не id).',
  no_facts: 'Укажи в factIds id фактов, на которых стоит текст.',
  too_many_sentences: 'Слишком много предложений: сократи.',
  first_person: 'Убери «я», «мы», «мой», «наш» (I, we, my, our).',
  language: 'Пиши на языке из входа.',
  ungrounded_number: 'Каждое число должно стоять в фактах, указанных в factIds; других чисел не пиши.',
  copy: 'Факт стоит в тексте дословно: перескажи своими словами.',
  skills: 'Только навыки из facts, ровно как там, без повторов; если есть keep, все навыки из него остаются и нужен хотя бы один не из keep.',
  repeat: 'Текст повторяет один из avoid: напиши иначе.',
  name: 'Есть название, которого нет в фактах: убери его.',
  action: 'Кандидату приписано действие, которого нет в фактах: убери его.',
  bullet: 'Одно предложение 12–250 знаков на нужном языке, без «я» и «мы», не дословно; числа только из фактов, своих расчётов нет.',
} as const;

export type VariantRejectCode = keyof typeof REASON_TEXT;
export type OnVariantReject = (reason: VariantRejectCode) => void;

const MAX_ATTEMPTS = 3;
/** Новая попытка не начинается, если кандидат уже ждёт дольше. Обычный ответ модели — 2–4 с. */
export const VARIANT_RETRY_BUDGET_MS = 25_000;
const REJECTED_TEXT_MAX = 2_000;

interface CheckedVariantJob<Request extends RetryableVariantRequest, Output extends { readonly text: string }, Accepted> {
  readonly request: Request;
  /** `null` — ни одна модель цепочки не ответила: повторять нечего. */
  readonly write: (request: Request) => Promise<Output | null | undefined>;
  readonly check: (output: Output, onReject: OnVariantReject) => Accepted | null;
  readonly onReject?: (reason: VariantRejectCode, attempt: number) => void;
  readonly now?: () => number;
}

/** Первый ответ, прошедший проверку; `null` — не нашёлся в пределах попыток и времени. */
export async function writeCheckedVariant<
  Request extends RetryableVariantRequest, Output extends { readonly text: string }, Accepted,
>(job: CheckedVariantJob<Request, Output, Accepted>): Promise<Accepted | null> {
  const now = job.now ?? Date.now;
  const deadline = now() + VARIANT_RETRY_BUDGET_MS;
  let request = job.request;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && now() < deadline; attempt += 1) {
    const output = await job.write(request);
    if (!output) return null;
    const reasons: VariantRejectCode[] = [];
    const accepted = job.check(output, (reason) => reasons.push(reason));
    if (accepted !== null) return accepted;
    reasons.forEach((reason) => job.onReject?.(reason, attempt));
    const reason = reasons.map((code) => REASON_TEXT[code]).join(' ');
    request = { ...job.request, rejected: { text: output.text.slice(0, REJECTED_TEXT_MAX), reason } };
  }
  return null;
}
