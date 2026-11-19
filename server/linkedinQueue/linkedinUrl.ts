/** https-ссылка на домен linkedin.com (или его поддомен) без учётных данных. */
export function isLinkedinUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (host === 'linkedin.com' || host.endsWith('.linkedin.com'));
  } catch {
    return false;
  }
}
