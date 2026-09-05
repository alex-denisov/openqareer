import { apiFetch, CoachApiError, readDataObject, throwApiError } from './apiClient';

interface Part {
  contentBase64: string;
  offset: number;
  nextOffset: number | null;
  byteLength: number;
  sha256: string;
}

function incomplete(): CoachApiError {
  return new CoachApiError('Не удалось получить ответ полностью. Повторите попытку.', 'delivery_incomplete', true);
}

/** Ход ещё идёт: это ожидание, а не поломка, и называть его надо честно. */
function stillRunning(): CoachApiError {
  return new CoachApiError('Ответ ещё готовится. Откройте разговор чуть позже — генерация не повторится.', 'turn_still_running', true);
}

/**
 * Сколько клиент ждёт сохранённый результат.
 *
 * Сервер обещает ход до 190 секунд: три роли по `PROVIDER_STAGE_TIMEOUT_MS`
 * (50 с) внутри собственного `requestTimeout`. Клиент ждал 180 с и сдавался
 * раньше своего же сервера, объявляя сломанной доставку хода, который ещё шёл.
 * Замер на проде 2026-09-05: результат приходил на 74-й и на 160-й секунде.
 * Потолок покрывает серверное обещание и оставляет запас на саму передачу.
 */
const RESULT_WAIT_MS = 240_000;

async function readWithDeadline<T>(url: string): Promise<{ pending: boolean; data?: T }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(incomplete()); }, 8_000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await apiFetch(url, { signal: controller.signal });
        if (response.status === 202) return { pending: true };
        if (!response.ok) await throwApiError(response);
        return { pending: false, data: await readDataObject(response) as T };
      })(), timeout,
    ]);
  } finally { clearTimeout(timer!); }
}

/** Normal paths receive one full response. Only failed delivery uses bounded parts. */
export async function receiveCoachResult<T extends object>(key: string): Promise<T> {
  const url = `/api/v1/coach/turn/${encodeURIComponent(key)}/result`;
  const deadline = Date.now() + RESULT_WAIT_MS;
  let pending = false;
  while (Date.now() < deadline) {
    try {
      const full = await readWithDeadline<T>(url);
      if (!full.pending) return full.data!;
      pending = true;
    } catch (error) {
      if (error instanceof CoachApiError && !['network_error', 'malformed_response', 'delivery_incomplete'].includes(error.code)) throw error;
      // Обрыв мог случиться и на ходе, который ещё идёт. Восстановление по
      // частям отвечает `undefined`, если операция всё ещё выполняется: тогда
      // мы возвращаемся к ожиданию, а не объявляем доставку сломанной.
      const parts = await receiveParts<T>(url);
      if (parts) return parts;
      pending = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw pending ? stillRunning() : incomplete();
}

/** `undefined` means the operation is still running: wait, do not fail it. */
async function receiveParts<T extends object>(url: string): Promise<T | undefined> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let expectedLength: number | undefined;
  let expectedDigest: string | undefined;
  while (true) {
    let part: Part | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await readWithDeadline<Part>(`${url}?offset=${offset}`);
        if (response.pending) return undefined;
        if (!response.data) throw incomplete();
        part = response.data;
        break;
      } catch (error) {
        if (error instanceof CoachApiError && !error.retryable) throw error;
        if (attempt === 1) throw incomplete();
      }
    }
    if (!part || part.offset !== offset || !Number.isSafeInteger(part.byteLength) ||
      part.byteLength <= 0 || part.byteLength > 5 * 1024 * 1024 ||
      typeof part.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(part.sha256) ||
      typeof part.contentBase64 !== 'string' || part.contentBase64.length > 10_924) throw incomplete();
    expectedLength ??= part.byteLength;
    expectedDigest ??= part.sha256;
    if (part.byteLength !== expectedLength || part.sha256 !== expectedDigest) throw incomplete();
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(part.contentBase64), (char) => char.charCodeAt(0)); }
    catch { throw incomplete(); }
    if (!bytes.length || bytes.length > 8_192 || offset + bytes.length > expectedLength) throw incomplete();
    chunks.push(bytes);
    offset += bytes.length;
    if (part.nextOffset === null) {
      if (offset !== expectedLength) throw incomplete();
      break;
    }
    if (part.nextOffset !== offset) throw incomplete();
  }
  const joined = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) { joined.set(chunk, cursor); cursor += chunk.length; }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', joined)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== expectedDigest) throw incomplete();
  try {
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw incomplete();
    return result as T;
  } catch { throw incomplete(); }
}
