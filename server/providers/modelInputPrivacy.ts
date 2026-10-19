/** Strip contacts and hidden markers; preserve evidence content needed for matching. */
export function minimizeModelText(text: string): string {
  return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[contact removed]')
    .replace(/https?:\/\/[^\s<>]+/giu, '[link removed]')
    .replace(/(?:\+\d[\s().-]*){1}(?:\d[\s().-]*){8,}/gu, '[phone removed]')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, '');
}
