import { apiFetch, readData } from '../../coach/apiClient';

const PROFILE_API = '/api/v1/candidate/profile';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Потолок файла фото; тот же, что проверяет сервер. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const INCOME_MAX_RUBLES = 100_000_000;

export interface PhotoResult {
  readonly photoMediaId: string | null;
}

export interface ProfileIncome {
  /** Доход сейчас, ₽ в месяц на руки. */
  readonly current: number | null;
  readonly expected: number | null;
}

/** Причина не отправлять файл; формат проверяет сервер по содержимому. */
export function photoFileError(file: { readonly size: number }): string | null {
  if (file.size === 0) return 'Подойдёт фото в JPEG или PNG.';
  return file.size > PHOTO_MAX_BYTES ? 'Фото больше 5 МБ.' : null;
}

/** До такой длинной стороны экран уменьшает снимок перед отправкой. */
const PHOTO_SEND_SIDE = 1280;
const PHOTO_SEND_QUALITY = 0.9;

/**
 * Уменьшает снимок в браузере и собирает его заново как JPEG: серверу не
 * приходится разбирать кадр с телефона на десятки мегапикселей, а метаданные
 * снимка (место, устройство) не покидают устройство кандидата.
 * Файл, который не открылся как картинка, отклоняется сразу.
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(UNREADABLE_PHOTO);
  }
  try {
    const scale = Math.min(1, PHOTO_SEND_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(UNREADABLE_PHOTO);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', PHOTO_SEND_QUALITY),
    );
    if (!blob) throw new Error(UNREADABLE_PHOTO);
    return blob;
  } finally {
    bitmap.close();
  }
}

export const UNREADABLE_PHOTO = 'Файл не открылся как фото.';

async function base64Of(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/** Загружает своё фото. Уходит только содержимое: имя и тип файла сервер не принимает. */
export async function uploadPhoto(file: Blob): Promise<PhotoResult> {
  const response = await apiFetch(`${PROFILE_API}/photo`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ contentBase64: await base64Of(file) }),
  });
  return readData<PhotoResult>(response);
}

export async function removePhoto(): Promise<PhotoResult> {
  const response = await apiFetch(`${PROFILE_API}/photo`, { method: 'DELETE' });
  return readData<PhotoResult>(response);
}

export async function getIncome(signal?: AbortSignal): Promise<ProfileIncome> {
  const response = await apiFetch(`${PROFILE_API}/income`, { signal });
  return readData<ProfileIncome>(response);
}

export async function saveIncome(income: ProfileIncome): Promise<ProfileIncome> {
  const response = await apiFetch(`${PROFILE_API}/income`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(income),
  });
  return readData<ProfileIncome>(response);
}

/** «Вернуть» у отменённой правки: применить её снова. */
export async function reapplyChange(changeId: string): Promise<void> {
  const response = await apiFetch(
    `${PROFILE_API}/history/${encodeURIComponent(changeId)}/reapply`,
    { method: 'POST' },
  );
  await readData<{ readonly reapplied: boolean }>(response);
}

/** Сумма из поля ввода: число, `null` для пустого поля или `'invalid'`. */
export function incomeAmount(text: string): number | null | 'invalid' {
  const digits = text.replace(/[\s₽]/gu, '');
  if (digits === '') return null;
  if (!/^\d+$/u.test(digits)) return 'invalid';
  const value = Number(digits);
  return value >= 1 && value <= INCOME_MAX_RUBLES ? value : 'invalid';
}

const RUBLES = new Intl.NumberFormat('ru-RU');

export function incomeLabel(value: number | null): string | null {
  return value === null ? null : `${RUBLES.format(value)} ₽ на руки`;
}
