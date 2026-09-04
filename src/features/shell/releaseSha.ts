import { apiFetch } from '../coach/apiClient';

/**
 * B159 — SHA текущего продакшн-релиза. В десктопе `apiFetch` уходит на
 * `https://openqareer.com`, в вебе — на свой же адрес, поэтому один вызов
 * годится обеим сборкам.
 *
 * Молчание продакшена — это `null`, а не «всё в порядке»: сравнивать сборку
 * будет не с чем, и интерфейс скажет об этом прямо.
 */
export async function readReleaseSha(): Promise<string | null> {
  try {
    const response = await apiFetch('/health', { headers: { Accept: 'text/plain' } });
    if (!response.ok) return null;
    const body = (await response.text()).trim();
    return body.length > 0 ? body : null;
  } catch {
    return null;
  }
}
